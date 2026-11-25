'use strict';
const fs = require('fs');

function readContent(path) {
  const text = fs.readFileSync(path, 'utf8');
  return text.split('\n').map(line => line.split(','));
}

module.exports = { readContent };
