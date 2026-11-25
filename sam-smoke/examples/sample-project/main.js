'use strict';
const { loadConfig } = require('./store/config');
const { registerHandlers } = require('./ui/import');
const { startTimer, stopTimer } = require('./sync/timer');
const { flush } = require('./store/save');

function main() {
  const config = loadConfig();
  registerHandlers(config);
  startTimer(config.syncMinutes);
}

function shutdown() {
  stopTimer();
  flush();
  process.exit(0);
}

process.on('SIGINT', shutdown);
main();
