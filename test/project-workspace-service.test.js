const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { ProjectWorkspaceService } = require('../src/project-workspaces/project-workspace-service');
const {
  createDefaultProjectWorkspaceState,
  validateProjectWorkspaceState,
} = require('../src/project-workspaces/project-workspace-state');

test('imports folder terminals and creates new terminals inside the active project workspace', async () => {
  let state = createDefaultProjectWorkspaceState();
  const sessions = [
    {
      id: 'terminal-existing',
      workspace: { kind: 'folder', projectPath: 'C:\\projects\\one', repository: null },
      workspaceStatus: { status: 'available', path: 'C:\\projects\\one' },
    },
    {
      id: 'terminal-existing-worktree',
      workspace: {
        kind: 'git-worktree',
        projectPath: 'C:\\projects\\one-agent',
        repository: {
          root: 'C:\\projects\\one',
          branch: 'refs/heads/agent',
          worktree: {
            path: 'C:\\projects\\one-agent',
            ownership: { kind: 'external', creationId: null },
          },
        },
      },
      workspaceStatus: { status: 'available', path: 'C:\\projects\\one-agent' },
    },
  ];
  const assigned = [];
  const terminalWorkspaceService = {
    assignFolder: async (id, projectPath) => {
      assigned.push({ id, projectPath });
      const session = sessions.find((candidate) => candidate.id === id);
      session.workspace = { kind: 'folder', projectPath, repository: null };
      session.workspaceStatus = { status: 'available', path: projectPath };
    },
    create: async () => {
      const session = {
        id: 'terminal-created',
        workspace: { kind: 'unassigned', projectPath: null, repository: null },
        workspaceStatus: { status: 'unassigned' },
      };
      sessions.push(session);
      return session;
    },
    get: (id) => sessions.find((session) => session.id === id),
    has: (id) => sessions.some((session) => session.id === id),
    list: () => ({ activeTerminalId: 'terminal-existing', sessions }),
    remove: async (id) =>
      sessions.splice(
        sessions.findIndex((session) => session.id === id),
        1,
      ),
  };
  const service = new ProjectWorkspaceService({
    idFactory: (() => {
      const ids = [
        'workspace-00000000-0000-4000-8000-000000000001',
        'workspace-00000000-0000-4000-8000-000000000002',
      ];
      return () => ids.shift();
    })(),
    pathModule: path.win32,
    stateStore: {
      load: async () => ({ issue: null, state: JSON.parse(JSON.stringify(state)) }),
      save: async (next) => {
        validateProjectWorkspaceState(next);
        state = JSON.parse(JSON.stringify(next));
      },
    },
    terminalWorkspaceService,
    validateFolder: async (projectPath) => path.win32.normalize(projectPath),
  });

  const imported = await service.initialize();
  assert.equal(imported.workspaces.length, 1);
  assert.deepEqual(imported.workspaces[0].terminalIds, [
    'terminal-existing',
    'terminal-existing-worktree',
  ]);

  const second = await service.add('C:\\projects\\two');
  const terminal = await service.createTerminal(second.id);
  assert.equal(terminal.id, 'terminal-created');
  assert.deepEqual(assigned, [{ id: 'terminal-created', projectPath: 'C:\\projects\\two' }]);
  assert.deepEqual(service.get(second.id).terminalIds, ['terminal-created']);
});
