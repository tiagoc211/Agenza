const ORCHESTRATION_CHANNELS = Object.freeze({
  createAgent: 'agenza:orchestration:create-agent',
  getState: 'agenza:orchestration:get-state',
  removeAgent: 'agenza:orchestration:remove-agent',
  sendMessage: 'agenza:orchestration:send-message',
  setOrchestrator: 'agenza:orchestration:set-orchestrator',
  stateChanged: 'agenza:orchestration:state-changed',
});

module.exports = { ORCHESTRATION_CHANNELS };
