'use strict';
const fs = require('fs');

function loadConfig() {
  const text = fs.readFileSync('config.json', 'utf8');
  return JSON.parse(text);
}

module.exports = { loadConfig };
