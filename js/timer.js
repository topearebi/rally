/**
 * Rally - Timer engine.
 * Owns the background ticker (Web Worker with a main-thread fallback), detects phase
 * completion, plays cues, fires optional system notifications and manages the screen
 * wake lock. The store holds the truth; this module just watches the clock.
 */

import { store, getElapsedMs } from './state.js';
import { MODE_LABELS, SYNC } from './config.js';
import { sound } from './audio.js';

const RUNNING_TICK_MS = 250;
const IDLE_TICK_MS = 1000;

class TimerEngine {
  constructor() {
    this.worker = null;
    this.fallbackId = null;
    this.tickMs = 0;
    this.listeners = new Set();
    this.transitionListeners = new Set();
    this.wakeLock = null;
    this.heldAtZeroSince = null;
  }

  init() {
    try {
      this.worker = new Worker(new URL('./worker.js', import.meta.url));
      this.worker.onmessage = (e) => e.data?.type === 'TICK' && this.tick(e.data.now);
      this.worker.onerror = () => this.useFallback();
    } catch (err) {
      this.useFallback();
    }

    this.recoverOverdueSession();

    store.subscribe((state) => {
      this.setTickRate(state.session.status === 'running' ? RUNNING_TICK_MS : IDLE_TICK_MS);
      this.syncWakeLock(state.session.status === 'running');
      if (state.session.status !== 'running') this.heldAtZeroSince = null;
    });

    document.addEventListener('visibilitychange', () => {
      // Wake locks are dropped when the page is hidden; re-acquire on return.
      if (document.visibilityState === 'visible') {
        this.syncWakeLock(store.getState().session.status === 'running');
        this.tick(Date.now());
      }
    });
  }

  /** Subscribe to clock ticks (used to repaint digits / peer timers). */
  onTick(fn) {
    this.listeners.add(fn);
  }

  useFallback() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    const rate = this.tickMs || IDLE_TICK_MS;
    this.tickMs = 0;
    this.setTickRate(rate);
  }

  setTickRate(ms) {
    if (ms === this.tickMs) return;
    this.tickMs = ms;
    if (this.worker) {
      this.worker.postMessage({ command: 'START', intervalMs: ms });
    } else {
      clearInterval(this.fallbackId);
      this.fallbackId = setInterval(() => this.tick(Date.now()), ms);
    }
    this.tick(Date.now());
  }

  tick(now) {
    const state = store.getState();
    for (const fn of this.listeners) fn(state, now);

    const s = state.session;
    if (s.status !== 'running' || getElapsedMs(s, now) < s.durationMs) return;

    // When following a linked host, wait for the host to change phase so both
    // sides transition together; only advance alone if the host goes quiet.
    if (store.isFollowing()) {
      this.heldAtZeroSince ??= now;
      if (now - this.heldAtZeroSince < SYNC.followGraceMs) return;
    }
    this.heldAtZeroSince = null;
    this.complete({ natural: true });
  }

  /** If the app was closed mid-phase long ago, move on quietly instead of blasting a chime. */
  recoverOverdueSession() {
    const s = store.getState().session;
    if (s.status !== 'running') return;
    const overdue = getElapsedMs(s) - s.durationMs;
    if (overdue > 60_000) store.advanceSession({ natural: true, suppressAutoStart: true });
  }

  /* ----------------------------- user actions ----------------------------- */

  toggle() {
    const { status } = store.getState().session;
    if (status === 'running') store.pauseTimer();
    else {
      sound.unlock();
      store.startTimer();
    }
  }

  skip() {
    this.complete({ natural: false });
  }

  reset() {
    return store.reset();
  }

  complete({ natural }) {
    const result = store.advanceSession({ natural });
    this.cue(result);
    return result;
  }

  /** Plays the sound / announcement / notification for a phase transition. */
  cue({ from, to, completedSession }) {
    const state = store.getState();
    if (state.config.soundEnabled) {
      if (completedSession) sound.playSessionComplete();
      else if (to === 'longRest') sound.playLongRestFanfare();
      else if (to === 'shortRest') sound.playSprintComplete();
      else sound.playRestComplete();
    }

    const message = completedSession
      ? `Session complete — ${state.session.currentRound} round${state.session.currentRound === 1 ? '' : 's'} done.`
      : `${MODE_LABELS[from]} done. ${state.session.status === 'running' ? 'Now' : 'Up next'}: ${MODE_LABELS[to]}.`;

    for (const fn of this.transitionListeners) fn(message, { from, to, completedSession });
    this.notify(message);
  }

  onTransition(fn) {
    this.transitionListeners.add(fn);
  }

  notify(message) {
    const { notificationsEnabled } = store.getState().config;
    if (!notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;
    try {
      const n = new Notification('Rally', { body: message, icon: './icons/icon-192.png', tag: 'rally-phase', renotify: true });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (_) {
      // Some mobile browsers only allow notifications from a service worker; ignore.
    }
  }

  /* ------------------------------- wake lock ------------------------------- */

  async syncWakeLock(shouldHold) {
    if (!('wakeLock' in navigator)) return;
    if (shouldHold && !this.wakeLock && document.visibilityState === 'visible') {
      this.wakeLock = 'pending';
      try {
        const sentinel = await navigator.wakeLock.request('screen');
        this.wakeLock = sentinel;
        sentinel.addEventListener('release', () => {
          if (this.wakeLock === sentinel) this.wakeLock = null;
        });
        if (store.getState().session.status !== 'running') this.syncWakeLock(false);
      } catch (_) {
        this.wakeLock = null;
      }
    } else if (!shouldHold && this.wakeLock && this.wakeLock !== 'pending') {
      const sentinel = this.wakeLock;
      this.wakeLock = null;
      sentinel.release().catch(() => {});
    }
  }
}

export const timer = new TimerEngine();
