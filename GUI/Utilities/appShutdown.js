'use strict';

// Electron does not await async before-quit listeners. Hold the first quit until
// worker stop promises finish, then allow one final quit through the guard.
function registerAppShutdown({ app, beforeShutdown = () => {}, shutdownTasks = [],
  timeoutMs = 5000, reportError = error => console.error('Worker shutdown failed:', error) }) {
  let started = false, complete = false, pending = null;
  function beforeQuit(event) {
    if (complete) return;
    event.preventDefault();
    if (started) return;
    started = true;
    pending = (async () => {
      try { beforeShutdown(); } catch (error) { reportError(error); }
      let timer;
      const stopped = Promise.allSettled(shutdownTasks.map(stop => Promise.resolve().then(stop))).then(results => {
        for (const result of results) if (result.status === 'rejected') reportError(result.reason);
      });
      try {
        await Promise.race([stopped, new Promise(resolve => {
          timer = setTimeout(() => {
            reportError(new Error('Worker shutdown exceeded its time limit.'));
            resolve();
          }, timeoutMs);
        })]);
      } finally {
        clearTimeout(timer);
        complete = true;
        app.quit();
      }
    })();
  }
  app.on('before-quit', beforeQuit);
  return { isQuitting: () => started, whenFinished: () => pending || Promise.resolve() };
}

module.exports = { registerAppShutdown };
