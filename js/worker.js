/**
 * Rally - Background ticker.
 * Timers in a dedicated worker are throttled far less than main-thread timers when the
 * tab is hidden, so phase changes (and their sounds) still fire on time. The worker only
 * ticks; all timing maths uses wall-clock timestamps on the main thread.
 */

let timerId = null;

self.onmessage = (event) => {
  const { command, intervalMs = 250 } = event.data || {};
  if (command === 'START') {
    clearInterval(timerId);
    timerId = setInterval(() => self.postMessage({ type: 'TICK', now: Date.now() }), intervalMs);
  } else if (command === 'STOP') {
    clearInterval(timerId);
    timerId = null;
  }
};
