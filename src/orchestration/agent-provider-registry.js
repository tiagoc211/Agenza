class AgentProviderRegistry {
  constructor(providers = {}) {
    this._providers = new Map();
    for (const [name, provider] of Object.entries(providers)) this.register(name, provider);
  }

  register(name, provider) {
    if (typeof name !== 'string' || !name || !provider) {
      throw new TypeError('A provider registration requires a name and implementation.');
    }
    for (const method of ['start', 'sendInstruction', 'stop', 'getStatus', 'onEvent', 'dispose']) {
      if (typeof provider[method] !== 'function') {
        throw new TypeError(`Agent provider "${name}" must implement ${method}().`);
      }
    }
    if (this._providers.has(name)) {
      throw new Error(`Agent provider "${name}" is already registered.`);
    }
    this._providers.set(name, provider);
    return provider;
  }

  get(name) {
    const provider = this._providers.get(name);
    if (!provider) throw new Error(`Agent provider "${name}" is unavailable.`);
    return provider;
  }

  list() {
    return [...this._providers.keys()];
  }

  dispose() {
    const errors = [];
    for (const provider of this._providers.values()) {
      try {
        provider.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Unable to dispose every agent provider.');
  }
}

module.exports = { AgentProviderRegistry };
