/**
 * Rally - Peer-to-peer room sync (WebRTC data channels via PeerJS).
 *
 * Topology: a star around the host. The room code IS the host's peer id; every guest
 * opens one data channel to the host and the host relays each member's presence to
 * the others. One connection per guest keeps things reliable behind strict NATs and
 * avoids duplicate-mesh bugs.
 *
 * PeerJS (vendored in /vendor) is only loaded when a room is opened, so solo use makes
 * no network requests at all. A signalling broker introduces peers; all room data then
 * flows directly between browsers.
 */

import { store, getElapsedMs } from './state.js';
import { timer } from './timer.js';
import {
  PEER_OPTIONS, ROOM_PREFIX, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, SYNC, MODES, PEER_COLORS, LIMITS,
} from './config.js';

const HOSTED_KEY = 'rally_hosted_room';
const PROTOCOL = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randomCode(length = ROOM_CODE_LENGTH) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('');
}

/** Accepts a bare code, "rally-code", or a full invite link. Returns the peer id or null. */
export function normalizeRoomInput(raw) {
  let code = String(raw || '').trim().toLowerCase();
  const fromLink = code.match(/room=([a-z0-9_-]+)/);
  if (fromLink) code = fromLink[1];
  code = code.replace(/^rally-/, '').replace(/[^a-z0-9]/g, '');
  return code.length >= 4 ? `${ROOM_PREFIX}${code}` : null;
}

export const roomCodeFromId = (id) => (id || '').replace(ROOM_PREFIX, '');

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Defensive parsing of a remote presence packet. */
function sanitizePresence(p) {
  if (!p || typeof p !== 'object') return null;
  const t = p.timer || {};
  const stones = Array.isArray(p.quest?.stones) ? p.quest.stones.slice(0, LIMITS.maxStones) : [];
  return {
    displayName: str(p.profile?.displayName, LIMITS.nameLength) || 'Teammate',
    avatarColor: PEER_COLORS.includes(p.profile?.avatarColor) ? p.profile.avatarColor : PEER_COLORS[0],
    isHost: Boolean(p.room?.isHost),
    quest: {
      title: str(p.quest?.title, LIMITS.questLength),
      stones: stones
        .filter((s) => s && typeof s.text === 'string')
        .map((s, i) => ({ id: str(s.id, 64) || `s${i}`, text: str(s.text, LIMITS.stoneLength), completed: Boolean(s.completed) })),
    },
    timer: {
      mode: MODES.includes(t.mode) ? t.mode : 'sprint',
      status: ['idle', 'running', 'paused', 'complete'].includes(t.status) ? t.status : 'idle',
      currentRound: Math.max(1, Number(t.currentRound) || 1),
      durationMs: Math.max(1000, Number(t.durationMs) || 0),
      elapsedMs: Math.max(0, Number(t.elapsedMs) || 0),
      receivedAt: Date.now(),
    },
    stats: {
      sprints: Math.max(0, Number(p.stats?.sprints) || 0),
      focusMs: Math.max(0, Number(p.stats?.focusMs) || 0),
    },
    linkTimers: Boolean(p.room?.linkTimers),
  };
}

class PeerSyncEngine {
  constructor() {
    this.peer = null;
    this.connections = new Map(); // peerId -> DataConnection (host: all guests; guest: just the host)
    this.latestPresence = new Map(); // host only: last raw presence per guest, replayed to newcomers
    this.libraryPromise = null;
    this.heartbeatId = null;
    this.hostRetryId = null;
    this.lastSignature = '';
    this.broadcastQueued = false;
    this.leaving = false;
    this.pendingJoin = null;
  }

  init() {
    store.subscribe(() => this.scheduleBroadcast());
    window.addEventListener('beforeunload', () => {
      for (const conn of this.connections.values()) {
        try { conn.close(); } catch (_) { /* noop */ }
      }
    });
  }

  /* ------------------------------ library ------------------------------ */

  loadLibrary() {
    if (window.Peer) return Promise.resolve();
    this.libraryPromise ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../vendor/peerjs.min.js', import.meta.url).href;
      script.onload = () => (window.Peer ? resolve() : reject(new Error('Sharing library failed to start.')));
      script.onerror = () => {
        this.libraryPromise = null;
        reject(new Error('Could not load the sharing library. Are you offline?'));
      };
      document.head.appendChild(script);
    });
    return this.libraryPromise;
  }

  /* ------------------------------ peer setup ------------------------------ */

  destroyPeer() {
    clearInterval(this.heartbeatId);
    clearInterval(this.hostRetryId);
    this.heartbeatId = null;
    this.hostRetryId = null;
    for (const conn of this.connections.values()) {
      try { conn.close(); } catch (_) { /* noop */ }
    }
    this.connections.clear();
    this.latestPresence.clear();
    if (this.peer) {
      const old = this.peer;
      this.peer = null;
      try { old.destroy(); } catch (_) { /* noop */ }
    }
  }

  /** Opens a broker session with the given id. Rejects with err.type on failure. */
  async openPeer(id) {
    await this.loadLibrary();
    this.destroyPeer();

    return new Promise((resolve, reject) => {
      const peer = new window.Peer(id, PEER_OPTIONS);
      this.peer = peer;
      let opened = false;

      peer.on('open', (assignedId) => {
        opened = true;
        this.startHeartbeat();
        resolve(assignedId);
      });

      peer.on('connection', (conn) => {
        if (store.getState().room.isHost) this.attach(conn);
        else conn.close();
      });

      peer.on('disconnected', () => {
        // Lost the broker only; existing data channels keep working. Reconnect quietly.
        if (this.peer !== peer || this.leaving || peer.destroyed) return;
        setTimeout(() => {
          if (this.peer === peer && peer.disconnected && !peer.destroyed) peer.reconnect();
        }, 1500);
      });

      peer.on('error', (err) => {
        if (this.peer !== peer) return;
        if (!opened) {
          reject(err);
          return;
        }
        this.handlePeerError(err);
      });
    });
  }

  handlePeerError(err) {
    const { roomId, isHost } = store.getState().room;
    if (err.type === 'peer-unavailable') {
      // Only matters when the host itself can't be found.
      if (!isHost && roomId && String(err.message || '').includes(roomId) && !this.connections.has(roomId)) {
        if (this.pendingJoin) this.pendingJoin.reject(new Error("That room isn't open right now. Check the code, or ask the host to open Rally."));
      }
      return;
    }
    if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
      if (!this.connections.size) store.setRoom({ connectionStatus: 'connecting' });
      return;
    }
    console.warn('[Rally] Peer error:', err.type, err);
  }

  /* ------------------------------ rooms ------------------------------ */

  async createRoom(preferredId = null) {
    this.leaving = false;
    store.setRoom({ connectionStatus: 'connecting', error: null });
    const attempts = preferredId ? SYNC.hostReclaimAttempts : 4;

    for (let i = 0; i < attempts; i++) {
      const id = preferredId || `${ROOM_PREFIX}${randomCode()}`;
      try {
        const roomId = await this.openPeer(id);
        try { sessionStorage.setItem(HOSTED_KEY, roomId); } catch (_) { /* noop */ }
        store.setRoom({ roomId, isHost: true, connectionStatus: 'connected', error: null });
        this.updateLocationHash(roomId);
        return roomId;
      } catch (err) {
        if (err?.type !== 'unavailable-id') {
          this.failRoom(err);
          throw this.friendlyError(err);
        }
        // Reclaiming after a reload: the broker may hold the old id for a few seconds.
        if (preferredId) await sleep(SYNC.hostReclaimDelayMs);
      }
    }
    const err = new Error(preferredId
      ? 'Could not re-open your room (the code is still busy). Try again in a moment.'
      : 'Could not create a room. Try again.');
    this.failRoom(err);
    throw err;
  }

  async joinRoom(rawInput) {
    const roomId = normalizeRoomInput(rawInput);
    if (!roomId) throw new Error('That code looks too short — room codes are 6 characters.');

    let hosted = null;
    try { hosted = sessionStorage.getItem(HOSTED_KEY); } catch (_) { /* noop */ }
    if (hosted === roomId) return this.createRoom(roomId);

    this.leaving = false;
    store.setRoom({ roomId, isHost: false, connectionStatus: 'connecting', error: null, peers: {}, hostLinked: false });
    this.updateLocationHash(roomId);

    try {
      await this.openPeer(`${ROOM_PREFIX}g${randomCode(10)}`);
      await this.connectToHost(roomId);
      this.startHostWatch();
      return roomId;
    } catch (err) {
      // A failed join returns you to solo with the reason shown, instead of a dead room.
      const friendly = this.friendlyError(err);
      this.destroyPeer();
      store.setRoom({ roomId: null, connectionStatus: 'disconnected', error: friendly.message });
      this.updateLocationHash(null);
      throw friendly;
    }
  }

  /** Opens the data channel to the host, resolving once it is open. */
  connectToHost(roomId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingJoin = null;
        reject(new Error("Couldn't reach that room. Check the code, or ask the host to open Rally."));
      }, SYNC.joinTimeoutMs);

      this.pendingJoin = {
        resolve: () => { clearTimeout(timeout); this.pendingJoin = null; resolve(); },
        reject: (e) => { clearTimeout(timeout); this.pendingJoin = null; reject(e); },
      };
      this.attach(this.peer.connect(roomId, { reliable: true, metadata: { v: PROTOCOL } }));
    });
  }

  /** Guests keep trying to reach the host (e.g. while the host reloads). */
  startHostWatch() {
    clearInterval(this.hostRetryId);
    this.hostRetryId = setInterval(() => {
      const { roomId, isHost } = store.getState().room;
      if (!roomId || isHost || !this.peer || this.peer.destroyed || this.connections.has(roomId)) return;
      if (this.peer.disconnected) return;
      this.attach(this.peer.connect(roomId, { reliable: true, metadata: { v: PROTOCOL } }));
    }, 4000);
  }

  async reconnect() {
    const { roomId, isHost } = store.getState().room;
    if (!roomId) return;
    return isHost ? this.createRoom(roomId) : this.joinRoom(roomId);
  }

  leaveRoom() {
    this.leaving = true;
    this.pendingJoin?.reject(new Error('Left the room.'));
    this.destroyPeer();
    try { sessionStorage.removeItem(HOSTED_KEY); } catch (_) { /* noop */ }
    store.setRoom({ roomId: null, connectionStatus: 'disconnected', error: null });
    this.updateLocationHash(null);
  }

  failRoom(err) {
    store.setRoom({ connectionStatus: 'disconnected', error: this.friendlyError(err).message });
  }

  friendlyError(err) {
    const map = {
      network: 'Network problem — check your connection and retry.',
      'server-error': 'The connection broker is unavailable right now. Try again shortly.',
      'browser-incompatible': 'This browser does not support peer-to-peer rooms.',
      'ssl-unavailable': 'Rooms need a secure (https) page.',
    };
    if (err instanceof Error && !err.type) return err;
    return new Error(map[err?.type] || err?.message || 'Something went wrong connecting.');
  }

  /* ------------------------------ connections ------------------------------ */

  attach(conn) {
    conn.on('open', () => {
      const previous = this.connections.get(conn.peer);
      this.connections.set(conn.peer, conn);
      if (previous && previous !== conn) {
        try { previous.close(); } catch (_) { /* noop */ }
      }

      const { isHost, roomId } = store.getState().room;
      store.setRoom({ connectionStatus: 'connected', error: null });
      conn.send(this.buildPresence());

      if (isHost) {
        // Bring the newcomer up to date with everyone already here.
        for (const [id, presence] of this.latestPresence) {
          if (id !== conn.peer) conn.send({ type: 'RELAY', from: id, presence });
        }
      } else if (conn.peer === roomId) {
        this.pendingJoin?.resolve();
      }
    });

    conn.on('data', (data) => this.handleData(conn.peer, data));

    const onGone = () => {
      if (this.connections.get(conn.peer) !== conn) return; // a newer channel replaced this one
      this.connections.delete(conn.peer);
      const { isHost, roomId } = store.getState().room;

      if (isHost) {
        this.latestPresence.delete(conn.peer);
        store.removePeer(conn.peer);
        this.sendAll({ type: 'LEAVE', id: conn.peer });
      } else if (conn.peer === roomId) {
        // Lost the host: clear the roster; the host watch will reconnect if they come back.
        const peers = store.getState().room.peers;
        Object.keys(peers).forEach((id) => store.removePeer(id));
        if (!this.leaving) store.setRoom({ connectionStatus: 'connecting', hostLinked: false });
      }
    };
    conn.on('close', onGone);
    conn.on('error', onGone);
  }

  sendAll(packet, exceptId = null) {
    for (const [id, conn] of this.connections) {
      if (id !== exceptId && conn.open) {
        try { conn.send(packet); } catch (_) { /* channel closing */ }
      }
    }
  }

  handleData(senderId, data) {
    if (!data || typeof data !== 'object') return;
    const { isHost, roomId } = store.getState().room;

    if (data.type === 'STATE') {
      const presence = sanitizePresence(data);
      if (!presence) return;
      store.updatePeer(senderId, presence);

      if (isHost) {
        this.latestPresence.set(senderId, data);
        this.sendAll({ type: 'RELAY', from: senderId, presence: data }, senderId);
      } else if (senderId === roomId) {
        this.applyHostPresence(presence);
      }
      return;
    }

    if (isHost) return; // guests only send STATE

    if (data.type === 'RELAY' && typeof data.from === 'string' && data.from !== this.peer?.id) {
      const presence = sanitizePresence(data.presence);
      if (presence) store.updatePeer(data.from, presence);
    } else if (data.type === 'LEAVE' && typeof data.id === 'string') {
      store.removePeer(data.id);
    }
  }

  applyHostPresence(presence) {
    const room = store.getState().room;
    if (room.hostLinked !== presence.linkTimers || room.hostName !== presence.displayName) {
      store.setRoom({ hostLinked: presence.linkTimers, hostName: presence.displayName });
    }
    if (!store.isFollowing()) return;

    const before = store.getState().session;
    const phaseChanged = store.applyHostTimer(presence.timer, presence.timer.receivedAt);
    if (phaseChanged && before.status !== 'idle') {
      const after = store.getState().session;
      timer.cue({
        from: before.mode,
        to: after.status === 'complete' ? 'complete' : after.mode,
        completedSession: after.status === 'complete',
      });
    }
  }

  /* ------------------------------ presence ------------------------------ */

  buildPresence() {
    const s = store.getState();
    return {
      type: 'STATE',
      v: PROTOCOL,
      profile: s.profile,
      quest: s.quest,
      timer: {
        mode: s.session.mode,
        status: s.session.status,
        currentRound: s.session.currentRound,
        durationMs: s.session.durationMs,
        elapsedMs: getElapsedMs(s.session),
      },
      stats: { sprints: s.stats.sprints, focusMs: s.stats.focusMs },
      room: { isHost: s.room.isHost, linkTimers: s.room.isHost && s.room.linkTimers },
    };
  }

  /** Coalesces bursts of store changes into one send; skips sends that change nothing. */
  scheduleBroadcast() {
    if (this.broadcastQueued || !this.connections.size) return;
    this.broadcastQueued = true;
    queueMicrotask(() => {
      this.broadcastQueued = false;
      this.broadcast(false);
    });
  }

  broadcast(force = true) {
    if (!this.connections.size) return;
    const packet = this.buildPresence();
    // While running, elapsed changes constantly — receivers extrapolate it, so ignore it here.
    const signature = JSON.stringify({ ...packet, timer: { ...packet.timer, elapsedMs: packet.timer.status === 'running' ? Math.round((Date.now() - packet.timer.elapsedMs) / 1000) : packet.timer.elapsedMs } });
    if (!force && signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.sendAll(packet);
  }

  startHeartbeat() {
    clearInterval(this.heartbeatId);
    this.heartbeatId = setInterval(() => {
      this.broadcast(true);
      const now = Date.now();
      const { peers } = store.getState().room;
      for (const [id, p] of Object.entries(peers)) {
        if (now - (p.lastSeen || 0) > SYNC.peerTimeoutMs && !this.connections.has(id)) store.removePeer(id);
      }
    }, SYNC.heartbeatMs);
  }

  /* ------------------------------ helpers ------------------------------ */

  updateLocationHash(roomId) {
    const url = roomId
      ? `${location.pathname}${location.search}#room=${roomCodeFromId(roomId)}`
      : `${location.pathname}${location.search}`;
    history.replaceState(null, '', url);
  }

  inviteLink(roomId) {
    return `${location.origin}${location.pathname}#room=${roomCodeFromId(roomId)}`;
  }
}

export const peerSync = new PeerSyncEngine();
