'use strict';
let timer = null;

function startTimer(minutes) {
  timer = setInterval(syncNow, minutes * 60000);
}

function syncNow() {
  console.log('sync');
}

function stopTimer() {
  clearInterval(timer);
}

module.exports = { startTimer, stopTimer };
