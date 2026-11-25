'use strict';
const { readContent } = require('../parser/read');
const { validate } = require('../parser/validate');
const { save } = require('../store/save');

function registerHandlers(config) {
  document.getElementById('btn-import').addEventListener('click', onImportClick);
}

function onImportClick(event) {
  const path = event.target.dataset.path;
  const rows = readContent(path);
  const checked = validate(rows);
  save(checked);
}

module.exports = { registerHandlers, onImportClick };
