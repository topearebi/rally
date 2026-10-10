/**
 * Rally - Reactive state store & persistence.
 *
 * Timing model: a phase is described by `durationMs`, `elapsedMs` and — while running —
 * `anchorTs` (the wall-clock time at which elapsed was 0). Elapsed time is always derived
 * from the clock, so the store does NOT change on every tick; only real events (start,
 * pause, phase change, edits) notify subscribers. Countdown vs count-up is purely a
 * display choice and can be switched at any time without corrupting progress.
 */

import { MODES, PEER_COLORS, LIMITS, SYNC } from './config.js';

const STORAGE_KEY = 'rally_state_v5';
const LEGACY_KEY = 'rally_state_v4';

const ADJECTIVES = ['Calm', 'Brave', 'Steady', 'Bright', 'Swift', 'Quiet', 'Bold', 'Keen'];
const ANIMALS = ['Otter', 'Falcon', 'Fox', 'Panda', 'Heron', 'Lynx', 'Koala', 'Orca'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const makeId = (prefix = 'stone') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function createDefaultState() {
  return {
    profile: {
      displayName: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
      avatarColor: pick(PEER_COLORS),
    },
    config: {
      sprintDurationSeconds: 25 * 60,
      shortRestDurationSeconds: 5 * 60,
      longRestDurationSeconds: 15 * 60,
      roundsBeforeLongRest: 4,
      totalRounds: 4, // 0 = keep going forever
      autoStartBreaks: true,
      autoStartSprints: false,
      timerDirection: 'countdown', // 'countdown' | 'countup' (display only)
      soundEnabled: true,
      soundProfile: 'warm', // 'warm' | 'crisp' | 'minimal'
      notificationsEnabled: false,
      focusView: false,
    },
    session: {
      mode: 'sprint',
      status: 'idle', // 'idle' | 'running' | 'paused' | 'complete'
      currentRound: 1,
      durationMs: 25 * 60 * 1000,
      elapsedMs: 0,
      anchorTs: null,
    },
    quest: {
      title: '',
      stones: [],
    },
    stats: { day: todayKey(), sprints: 0, focusMs: 0 },
    room: {
      roomId: null,
      isHost: false,
      connectionStatus: 'disconnected', // 'disconnected' | 'connecting' | 'connected'
      error: null,
      linkTimers: false, // host: everyone follows my timer
      followHost: true, // guest: whether I follow a linking host
      hostLinked: false, // guest: is the host currently linking timers
      hostName: null,
      peers: {},
    },
  };
}

/* ---------------------------- pure helpers ---------------------------- */

export function getElapsedMs(session, now = Date.now()) {
  if (session.status === 'running' && session.anchorTs != null) {
    return Math.max(0, now - session.anchorTs);
  }
  return session.elapsedMs;
}

export function getRemainingMs(session, now = Date.now()) {
  return Math.max(0, session.durationMs - getElapsedMs(session, now));
}

const clampInt = (v, min, max, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const cleanText = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function sanitizeStones(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .slice(0, LIMITS.maxStones)
    .map((s) => ({
      id: typeof s.id === 'string' ? s.id : makeId(),
      text: cleanText(s.text, LIMITS.stoneLength),
      completed: Boolean(s.completed),
    }));
}

/** Converts a v4 save (remaining-based timing) into the v5 shape. */
function migrateLegacy(parsed) {
  const base = createDefaultState();
  const cfg = { ...base.config, ...(parsed.config || {}) };
  const s = parsed.session || {};
  const durationMs = s.totalDurationMs || cfg.sprintDurationSeconds * 1000;
  let elapsedMs = 0;
  if (typeof s.remainingMs === 'number') {
    elapsedMs = cfg.timerDirection === 'countup' ? s.remainingMs : durationMs - s.remainingMs;
  }
  if (s.status === 'running' && s.targetTimestamp) {
    elapsedMs = cfg.timerDirection === 'countup'
      ? Date.now() - s.targetTimestamp
      : durationMs - (s.targetTimestamp - Date.now());
  }
  elapsedMs = Math.min(durationMs, Math.max(0, elapsedMs));
  return {
    profile: { ...parsed.profile },
    config: cfg,
    session: {
      mode: MODES.includes(s.mode) ? s.mode : 'sprint',
      status: elapsedMs > 0 && elapsedMs < durationMs ? 'paused' : 'idle',
      currentRound: s.currentRound || 1,
      durationMs,
      elapsedMs: elapsedMs >= durationMs ? 0 : elapsedMs,
      anchorTs: null,
    },
    quest: parsed.quest,
  };
}

/* ------------------------------- store -------------------------------- */

class StateStore {
  constructor() {
    this.subscribers = new Set();
    this.state = this.loadState();
    this.snapshot = null;
  }

  loadState() {
    const base = createDefaultState();
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      let parsed = raw ? JSON.parse(raw) : null;
      if (!parsed) {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) parsed = migrateLegacy(JSON.parse(legacy));
      }
      if (!parsed) return base;

      const profile = { ...base.profile, ...parsed.profile };
      // Old saves defaulted everyone to the same name/colour; give them a distinct colour.
      if (!PEER_COLORS.includes(profile.avatarColor) || (profile.avatarColor === '#38bdf8' && !parsed.stats)) {
        profile.avatarColor = base.profile.avatarColor;
      }
      if (!profile.displayName || profile.displayName === 'Player 1') {
        profile.displayName = base.profile.displayName;
      }

      const session = { ...base.session, ...parsed.session };
      if (!MODES.includes(session.mode)) session.mode = 'sprint';
      if (session.status === 'running' && session.anchorTs == null) session.status = 'paused';

      const stats = parsed.stats && parsed.stats.day === todayKey() ? { ...base.stats, ...parsed.stats } : base.stats;

      return {
        profile,
        config: { ...base.config, ...parsed.config },
        session,
        quest: {
          title: cleanText(parsed.quest?.title, LIMITS.questLength),
          stones: sanitizeStones(parsed.quest?.stones),
        },
        stats,
        room: base.room,
      };
    } catch (e) {
      console.warn('[Rally] Could not read saved state, starting fresh:', e);
      return base;
    }
  }

  persistState() {
    try {
      const { profile, config, session, quest, stats } = this.state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile, config, session, quest, stats }));
    } catch (e) {
      // Private mode / quota — the app still works for this visit.
    }
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    callback(this.getState());
    return () => this.subscribers.delete(callback);
  }

  notify({ persist = true } = {}) {
    if (persist) this.persistState();
    this.snapshot = null;
    const snapshot = this.getState();
    for (const cb of this.subscribers) cb(snapshot);
  }

  /** Returns a frozen-by-convention deep copy; cached until the next change. */
  getState() {
    if (!this.snapshot) this.snapshot = structuredClone(this.state);
    return this.snapshot;
  }

  /* ========================= Profile & Preferences ========================= */

  updateProfile({ displayName, avatarColor } = {}) {
    const name = cleanText(displayName, LIMITS.nameLength);
    if (name) this.state.profile.displayName = name;
    if (avatarColor && PEER_COLORS.includes(avatarColor)) this.state.profile.avatarColor = avatarColor;
    this.notify();
  }

  getDurationForMode(mode, config = this.state.config) {
    const seconds = {
      sprint: config.sprintDurationSeconds,
      shortRest: config.shortRestDurationSeconds,
      longRest: config.longRestDurationSeconds,
    }[mode] ?? config.sprintDurationSeconds;
    return Math.max(1, Math.round(seconds)) * 1000;
  }

  updateConfig(partial) {
    const c = { ...this.state.config, ...partial };
    c.sprintDurationSeconds = clampInt(c.sprintDurationSeconds, 1, 180 * 60, 1500);
    c.shortRestDurationSeconds = clampInt(c.shortRestDurationSeconds, 1, 60 * 60, 300);
    c.longRestDurationSeconds = clampInt(c.longRestDurationSeconds, 1, 120 * 60, 900);
    c.roundsBeforeLongRest = clampInt(c.roundsBeforeLongRest, 1, 16, 4);
    c.totalRounds = clampInt(c.totalRounds, 0, 32, 4);
    if (!['countdown', 'countup'].includes(c.timerDirection)) c.timerDirection = 'countdown';
    if (!['warm', 'crisp', 'minimal'].includes(c.soundProfile)) c.soundProfile = 'warm';
    this.state.config = c;

    // New durations apply immediately unless a phase is actively running
    // (or we are following a host, who owns the durations).
    const s = this.state.session;
    if (s.status !== 'running' && !this.isFollowing()) {
      s.durationMs = this.getDurationForMode(s.mode);
      if (s.elapsedMs >= s.durationMs) {
        s.elapsedMs = 0;
        if (s.status === 'paused') s.status = 'idle';
      }
    }
    this.notify();
  }

  /* ======================== Current Quest & Stones ======================== */

  setQuestTitle(title) {
    this.state.quest.title = cleanText(title, LIMITS.questLength);
    this.notify();
  }

  addSteppingStone(text) {
    const clean = cleanText(text, LIMITS.stoneLength);
    if (!clean || this.state.quest.stones.length >= LIMITS.maxStones) return null;
    const stone = { id: makeId(), text: clean, completed: false };
    this.state.quest.stones.push(stone);
    this.notify();
    return stone;
  }

  updateSteppingStone(id, text) {
    const stone = this.state.quest.stones.find((s) => s.id === id);
    const clean = cleanText(text, LIMITS.stoneLength);
    if (stone && clean && clean !== stone.text) {
      stone.text = clean;
      this.notify();
    }
  }

  /** Moves a pending stone up/down among the *pending* stones only. */
  moveSteppingStone(id, direction) {
    const stones = this.state.quest.stones;
    const index = stones.findIndex((s) => s.id === id);
    if (index === -1) return;
    const step = direction === 'up' ? -1 : 1;
    let target = index + step;
    while (target >= 0 && target < stones.length && stones[target].completed) target += step;
    if (target < 0 || target >= stones.length) return;
    [stones[index], stones[target]] = [stones[target], stones[index]];
    this.notify();
  }

  toggleSteppingStone(id) {
    const stone = this.state.quest.stones.find((s) => s.id === id);
    if (!stone) return false;
    stone.completed = !stone.completed;
    this.notify();
    return stone.completed;
  }

  deleteSteppingStone(id) {
    const stones = this.state.quest.stones;
    const index = stones.findIndex((s) => s.id === id);
    if (index === -1) return null;
    const [removed] = stones.splice(index, 1);
    this.notify();
    return { stone: removed, index };
  }

  clearCompletedStones() {
    const before = this.state.quest.stones;
    this.state.quest.stones = before.filter((s) => !s.completed);
    this.notify();
    return before.length - this.state.quest.stones.length;
  }

  /** Replaces the whole quest (used for undo). */
  restoreQuest(quest) {
    this.state.quest = { title: cleanText(quest.title, LIMITS.questLength), stones: sanitizeStones(quest.stones) };
    this.notify();
  }

  /** Clones a teammate's checklist. Returns the previous quest so the caller can offer undo. */
  importSteppingStones(stones, title) {
    const incoming = sanitizeStones(stones).map((s) => ({ ...s, id: makeId(), completed: false }));
    if (!incoming.length) return null;
    const previous = structuredClone(this.state.quest);
    this.state.quest = {
      title: this.state.quest.title || cleanText(title, LIMITS.questLength),
      stones: incoming,
    };
    this.notify();
    return previous;
  }

  /* ============================ Timer & Rounds ============================ */

  isFollowing() {
    const r = this.state.room;
    return Boolean(r.roomId && !r.isHost && r.hostLinked && r.followHost);
  }

  setPhase(mode, round = this.state.session.currentRound, durationMs = null) {
    if (!MODES.includes(mode)) return;
    Object.assign(this.state.session, {
      mode,
      status: 'idle',
      currentRound: Math.max(1, round),
      durationMs: durationMs ?? this.getDurationForMode(mode),
      elapsedMs: 0,
      anchorTs: null,
    });
  }

  startTimer(now = Date.now()) {
    const s = this.state.session;
    if (s.status === 'running') return;
    if (s.status === 'complete') this.setPhase('sprint', 1);
    s.status = 'running';
    s.anchorTs = now - s.elapsedMs;
    this.rollStatsDay();
    this.notify();
  }

  pauseTimer(now = Date.now()) {
    const s = this.state.session;
    if (s.status !== 'running') return;
    s.elapsedMs = Math.min(s.durationMs, getElapsedMs(s, now));
    s.status = 'paused';
    s.anchorTs = null;
    this.notify();
  }

  /**
   * First press restarts the current phase; pressing again on an untouched
   * phase restarts the whole session. Returns which one happened.
   */
  reset() {
    const s = this.state.session;
    const untouched = s.status === 'idle' && s.elapsedMs === 0;
    if (untouched || s.status === 'complete') {
      this.setPhase('sprint', 1);
      this.notify();
      return 'session';
    }
    this.setPhase(s.mode, s.currentRound, s.durationMs);
    this.notify();
    return 'phase';
  }

  /** Puts back a session snapshot (used to undo an accidental restart). */
  restoreSession(snapshot) {
    if (!snapshot || !MODES.includes(snapshot.mode)) return;
    this.state.session = { ...snapshot };
    this.notify();
  }

  rollStatsDay() {
    if (this.state.stats.day !== todayKey()) {
      this.state.stats = { day: todayKey(), sprints: 0, focusMs: 0 };
    }
  }

  /**
   * Moves to the next phase. `natural` is true when the timer ran out (vs. skip).
   * Returns a description of the transition for sounds/announcements.
   */
  advanceSession({ natural = true, suppressAutoStart = false, now = Date.now() } = {}) {
    const s = this.state.session;
    const c = this.state.config;
    const from = s.mode;
    const round = s.currentRound;

    if (s.status === 'complete') return { from, to: from, round, completedSession: true, autoStart: false };

    if (from === 'sprint') {
      this.rollStatsDay();
      const elapsed = Math.min(s.durationMs, getElapsedMs(s, now));
      this.state.stats.focusMs += elapsed;
      if (natural || elapsed >= s.durationMs * 0.5) this.state.stats.sprints += 1;
    }

    if (from === 'sprint' && c.totalRounds > 0 && round >= c.totalRounds) {
      Object.assign(s, { status: 'complete', elapsedMs: s.durationMs, anchorTs: null });
      this.notify();
      return { from, to: 'complete', round, completedSession: true, autoStart: false };
    }

    let to;
    let nextRound = round;
    let autoStart;
    if (from === 'sprint') {
      to = round % c.roundsBeforeLongRest === 0 ? 'longRest' : 'shortRest';
      autoStart = c.autoStartBreaks;
    } else {
      to = 'sprint';
      nextRound = round + 1;
      autoStart = c.autoStartSprints;
    }
    if (suppressAutoStart) autoStart = false;

    this.setPhase(to, nextRound);
    if (autoStart) {
      s.status = 'running';
      s.anchorTs = now;
    }
    this.notify();
    return { from, to, round: nextRound, completedSession: false, autoStart };
  }

  /**
   * Mirrors a linked host's timer. Returns true when the phase changed
   * (so the caller can play the transition cue).
   */
  applyHostTimer(timer, receivedAt = Date.now()) {
    if (!timer || !MODES.includes(timer.mode)) return false;
    const s = this.state.session;
    const hostElapsed = Math.max(0, Number(timer.elapsedMs) || 0);
    const durationMs = Math.max(1000, Number(timer.durationMs) || s.durationMs);
    const status = ['idle', 'running', 'paused', 'complete'].includes(timer.status) ? timer.status : 'idle';
    const phaseChanged = s.mode !== timer.mode || s.currentRound !== timer.currentRound || (status === 'complete') !== (s.status === 'complete');

    let changed = phaseChanged || s.status !== status || s.durationMs !== durationMs;
    const localElapsed = getElapsedMs(s, receivedAt);
    if (Math.abs(localElapsed - hostElapsed) > SYNC.followDriftMs) changed = true;
    if (!changed) return false;

    Object.assign(s, {
      mode: timer.mode,
      currentRound: Math.max(1, Number(timer.currentRound) || 1),
      durationMs,
      status,
      elapsedMs: Math.min(durationMs, hostElapsed),
      anchorTs: status === 'running' ? receivedAt - hostElapsed : null,
    });
    this.notify();
    return phaseChanged;
  }

  /* ============================== Room & Peers ============================== */

  setRoom(patch) {
    Object.assign(this.state.room, patch);
    if (patch.roomId === null) {
      Object.assign(this.state.room, { isHost: false, peers: {}, hostLinked: false, hostName: null, linkTimers: false });
    }
    this.notify({ persist: false });
  }

  updatePeer(peerId, data) {
    this.state.room.peers[peerId] = { ...this.state.room.peers[peerId], ...data, lastSeen: Date.now() };
    this.notify({ persist: false });
  }

  removePeer(peerId) {
    if (!this.state.room.peers[peerId]) return;
    delete this.state.room.peers[peerId];
    this.notify({ persist: false });
  }
}

export const store = new StateStore();
