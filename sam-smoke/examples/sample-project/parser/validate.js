'use strict';
const { convertLegacy } = require('./legacy');

function validate(rows) {
  if (rows.length && rows[0][0] === 'v1') {
    convertLegacy(rows);
  }
  return rows.filter(row => row.length >= 3);
}

module.exports = { validate };
