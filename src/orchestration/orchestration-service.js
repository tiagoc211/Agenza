const { randomBytes, randomUUID } = require('node:crypto');
const { Buffer } = require('node:buffer');
const http = require('node:http');
const { URL } = require('node:url');

const MAX_MESSAGE_LENGTH = 8000;
const MAX_REQUEST_BYTES = 16384;
const ORCHESTRATOR_BOOTSTRAP = [
  '[Agenza orchestration role]',
  'You are the selected orchestrator for this local Agenza prototype.',
  'Use `agenza-agent list` to inspect instances, `agenza-agent create` to create an unassigned instance,',
  '`agenza-agent send <terminal-id|all> <message>` to delegate or communicate,',
  '`agenza-agent inbox` to read replies, and `agenza-agent remove <terminal-id>` to remove only a terminal.',
  'Creating an instance does not assign a folder. Removing one preserves folders, worktrees, and branches.',
].join('\n');

const copyValue = (value) => JSON.parse(JSON.stringify(value));

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

class OrchestrationService {
  constructor({
    host = '127.0.0.1',
    now = () => new Date().toISOString(),
    serverFactory = (handler) => http.createServer(handler),
    terminalManager,
    tokenFactory = () => randomBytes(32).toString('base64url'),
    workspaceService,
  } = {}) {
    if (!terminalManager || !workspaceService) {
      throw new TypeError('Orchestration requires terminal and workspace services.');
    }

    this._host = host;
    this._now = now;
    this._serverFactory = serverFactory;
    this._terminalManager = terminalManager;
    this._tokenFactory = tokenFactory;
    this._workspaceService = workspaceService;
    this._server = null;
    this._url = null;
    this._orchestratorId = null;
    this._tokensByAgent = new Map();
    this._agentsByToken = new Map();
    this._mailboxes = new Map();
    this._stateListeners = new Set();
  }

  start() {
    if (this._server) {
      return Promise.resolve(this.getState());
    }

    const server = this._serverFactory((request, response) => {
      this._handleHttpRequest(request, response).catch((error) => {
        this._sendJson(response, error.statusCode ?? 500, {
          error: error.statusCode ? error.message : 'The orchestration request failed.',
        });
      });
    });
    this._server = server;

    return new Promise((resolve, reject) => {
      const handleError = (error) => {
        server.removeListener('listening', handleListening);
        this._server = null;
        reject(error);
      };
      const handleListening = () => {
        server.removeListener('error', handleError);
        const address = server.address();

        if (!address || typeof address === 'string') {
          this.dispose();
          reject(new Error('The orchestration broker did not bind to a TCP port.'));
          return;
        }

        this._url = `http://${this._host}:${address.port}`;
        resolve(this.getState());
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen(0, this._host);
    });
  }

  dispose() {
    const server = this._server;
    this._server = null;
    this._url = null;
    this._orchestratorId = null;
    this._tokensByAgent.clear();
    this._agentsByToken.clear();
    this._mailboxes.clear();
    this._stateListeners.clear();
    server?.close();
  }

  getState() {
    return {
      agents: this._listAgents(),
      brokerReady: Boolean(this._url),
      orchestratorId: this._orchestratorId,
    };
  }

  onStateChanged(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('An orchestration state listener must be a function.');
    }
    this._stateListeners.add(listener);
    return () => this._stateListeners.delete(listener);
  }

  setOrchestrator(id) {
    if (id !== null) {
      this._assertAgent(id);
    }

    const changed = this._orchestratorId !== id;
    this._orchestratorId = id;

    if (changed && id && this._terminalManager.getSnapshot(id).isRunning) {
      this._terminalManager.write(id, `${ORCHESTRATOR_BOOTSTRAP}\r`);
    }
    const state = this.getState();
    if (changed) {
      this._emitStateChanged({ state, type: 'orchestrator-changed' });
    }
    return state;
  }

  async createAgent({ requestedBy = null } = {}) {
    this._assertOrchestratorRequest(requestedBy);
    const snapshot = await this._workspaceService.create();
    const state = this.getState();
    this._emitStateChanged({ snapshot, state, type: 'agent-created' });
    return { snapshot, state };
  }

  async removeAgent(targetId, { requestedBy = null } = {}) {
    this._assertOrchestratorRequest(requestedBy);
    this._assertAgent(targetId);

    if (requestedBy && requestedBy === targetId) {
      throw new Error('The orchestrator cannot remove its own terminal.');
    }

    await this._workspaceService.remove(targetId);
    this._removeAgentRuntime(targetId);
    const state = this.getState();
    this._emitStateChanged({ id: targetId, state, type: 'agent-removed' });
    return { id: targetId, removed: true, state };
  }

  sendMessage({ message, requestedBy = null, targetIds }) {
    const normalizedMessage = this._validateMessage(message);
    const source = requestedBy === null ? null : this._getAgent(requestedBy);
    const recipients = this._resolveTargets(targetIds, requestedBy);
    const sourceLabel = source?.label ?? 'Agenza orchestrator';
    const kind = requestedBy === null || requestedBy === this._orchestratorId ? 'order' : 'message';
    const deliveries = [];

    for (const recipient of recipients) {
      const envelope = {
        createdAt: this._now(),
        fromId: requestedBy,
        fromLabel: sourceLabel,
        id: `message-${randomUUID()}`,
        kind,
        message: normalizedMessage,
        toId: recipient.id,
      };
      const mailbox = this._mailboxes.get(recipient.id) ?? [];
      mailbox.push(envelope);
      this._mailboxes.set(recipient.id, mailbox.slice(-100));

      let status = 'queued';
      if (recipient.isRunning) {
        const heading = kind === 'order' ? 'Agenza order' : 'Agenza agent message';
        this._terminalManager.write(
          recipient.id,
          `[${heading} from ${sourceLabel}]\n${normalizedMessage}\r`,
        );
        status = 'delivered';
      }

      deliveries.push({ id: envelope.id, status, targetId: recipient.id });
    }

    return { deliveries, kind, recipientCount: deliveries.length };
  }

  readInbox(id) {
    this._assertAgent(id);
    const messages = this._mailboxes.get(id) ?? [];
    this._mailboxes.set(id, []);
    return { messages: copyValue(messages), unreadCount: messages.length };
  }

  createAgentEnvironment(id, environment = process.env, toolDirectory = null) {
    this._assertAgent(id);

    if (!this._url) {
      throw new Error('The orchestration broker is not running.');
    }

    let token = this._tokensByAgent.get(id);
    if (!token) {
      token = this._tokenFactory();
      this._tokensByAgent.set(id, token);
      this._agentsByToken.set(token, id);
    }

    const result = {
      ...environment,
      AGENZA_AGENT_ID: id,
      AGENZA_AGENT_TOKEN: token,
      AGENZA_CONTROL_URL: this._url,
    };

    if (toolDirectory) {
      const pathKey = Object.keys(result).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
      result[pathKey] = [toolDirectory, result[pathKey]].filter(Boolean).join(';');
    }

    return result;
  }

  _listAgents() {
    const catalog = this._workspaceService.getCatalog();
    return catalog.sessions.map(({ id, isRunning, label, order, workspace }) => ({
      id,
      isOrchestrator: id === this._orchestratorId,
      isRunning,
      label,
      order,
      workspaceKind: workspace.kind,
    }));
  }

  _getAgent(id) {
    return this._listAgents().find((agent) => agent.id === id) ?? null;
  }

  _assertAgent(id) {
    if (typeof id !== 'string' || !this._terminalManager.has(id) || !this._getAgent(id)) {
      throw new Error('Unknown orchestration agent.');
    }
  }

  _assertOrchestratorRequest(requestedBy) {
    if (requestedBy === null) {
      return;
    }

    this._assertAgent(requestedBy);
    if (!this._orchestratorId || requestedBy !== this._orchestratorId) {
      throw new Error('Only the selected orchestrator can manage agent instances.');
    }
  }

  _resolveTargets(targetIds, requestedBy) {
    const agents = this._listAgents();
    const requested = targetIds === 'all' ? agents.map(({ id }) => id) : targetIds;

    if (!Array.isArray(requested) || requested.length === 0) {
      throw new Error('Select at least one target agent.');
    }

    const uniqueTargets = [...new Set(requested)];
    const recipients = uniqueTargets.map((id) => {
      const agent = agents.find((candidate) => candidate.id === id);
      if (!agent) {
        throw new Error('Unknown target agent.');
      }
      return agent;
    });

    const filteredRecipients = recipients.filter(({ id }) => id !== requestedBy);
    if (filteredRecipients.length === 0) {
      throw new Error('An agent cannot send an orchestration message only to itself.');
    }
    return filteredRecipients;
  }

  _validateMessage(message) {
    if (typeof message !== 'string') {
      throw new TypeError('An orchestration message must be text.');
    }

    const normalized = message.replace(/\r\n?/g, '\n').trim();
    if (
      normalized.length === 0 ||
      normalized.length > MAX_MESSAGE_LENGTH ||
      normalized.includes('\0')
    ) {
      throw new Error(
        `An orchestration message must contain 1-${MAX_MESSAGE_LENGTH} safe characters.`,
      );
    }
    return normalized;
  }

  _removeAgentRuntime(id) {
    const token = this._tokensByAgent.get(id);
    if (token) {
      this._agentsByToken.delete(token);
    }
    this._tokensByAgent.delete(id);
    this._mailboxes.delete(id);
    if (this._orchestratorId === id) {
      this._orchestratorId = null;
    }
  }

  _emitStateChanged(event) {
    for (const listener of this._stateListeners) {
      listener(copyValue(event));
    }
  }

  async _handleHttpRequest(request, response) {
    const requesterId = this._authenticate(request);
    const url = new URL(request.url, this._url);

    if (request.method === 'GET' && url.pathname === '/v1/whoami') {
      this._sendJson(response, 200, {
        agent: this._getAgent(requesterId),
        isOrchestrator: requesterId === this._orchestratorId,
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/agents') {
      this._sendJson(response, 200, this.getState());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/inbox') {
      this._sendJson(response, 200, this.readInbox(requesterId));
      return;
    }

    const body = await this._readJsonBody(request);
    if (request.method === 'POST' && url.pathname === '/v1/agents') {
      this._sendJson(response, 201, await this.createAgent({ requestedBy: requesterId }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/remove') {
      this._sendJson(
        response,
        200,
        await this.removeAgent(body.targetId, { requestedBy: requesterId }),
      );
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/messages') {
      this._sendJson(
        response,
        200,
        this.sendMessage({
          message: body.message,
          requestedBy: requesterId,
          targetIds: body.targetId === 'all' ? 'all' : [body.targetId],
        }),
      );
      return;
    }

    throw createHttpError(404, 'Unknown orchestration operation.');
  }

  _authenticate(request) {
    const authorization = request.headers.authorization;
    const token = typeof authorization === 'string' ? authorization.replace(/^Bearer\s+/i, '') : '';
    const id = this._agentsByToken.get(token);
    if (!id || !this._terminalManager.has(id)) {
      throw createHttpError(401, 'Invalid Agenza agent token.');
    }
    return id;
  }

  _readJsonBody(request) {
    return new Promise((resolve, reject) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
          reject(createHttpError(413, 'The orchestration request is too large.'));
          request.destroy();
        }
      });
      request.on('end', () => {
        if (body.length === 0) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(createHttpError(400, 'The orchestration request must contain valid JSON.'));
        }
      });
      request.on('error', reject);
    });
  }

  _sendJson(response, statusCode, payload) {
    if (response.headersSent || response.destroyed) {
      return;
    }
    const body = JSON.stringify(payload);
    response.writeHead(statusCode, {
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(body);
  }
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  ORCHESTRATOR_BOOTSTRAP,
  OrchestrationService,
};
