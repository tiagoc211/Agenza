const TERMINAL_CHANNELS = Object.freeze({
  create: 'agenza:terminal:create',
  list: 'agenza:terminal:list',
  remove: 'agenza:terminal:remove',
  start: 'agenza:terminal:start',
  restart: 'agenza:terminal:restart',
  input: 'agenza:terminal:input',
  resize: 'agenza:terminal:resize',
  data: 'agenza:terminal:data',
  exit: 'agenza:terminal:exit',
});

module.exports = { TERMINAL_CHANNELS };
