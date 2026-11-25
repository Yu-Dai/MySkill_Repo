'use strict';
const plugins = require('./plugins');

const pending = [];

function save(rows) {
  pending.push(...rows);
  notify('saved', rows.length);
}

function notify(eventName, count) {
  const handler = plugins[eventName + 'Handler'];
  if (handler) handler(count);
}

function flush() {
  pending.length = 0;
}

module.exports = { save, flush };
