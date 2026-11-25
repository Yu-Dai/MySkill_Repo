'use strict';

function convertLegacy(rows) {
  const converted = rows.map(row => row.slice(1));
  return converted;
}

module.exports = { convertLegacy };
