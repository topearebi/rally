/**
 * Rally - Static configuration & constants.
 * Everything tunable lives here so the rest of the code stays free of magic numbers.
 */

export const MODES = /** @type {const} */ (['sprint', 'shortRest', 'longRest']);

export const MODE_LABELS = {
  sprint: 'Sprint',
  shortRest: 'Short Rest',
  longRest: 'Long Rest',
};

/** Accent colours per phase — mirrored in css/tokens.css and used by the favicon. */
export const MODE_COLORS = {
  sprint: { accent: '#fbbf24', bg: '#0d0f17' },
  shortRest: { accent: '#34d399', bg: '#061812' },
  longRest: { accent: '#a78bfa', bg: '#0f1123' },
};

export const PEER_COLORS = ['#38bdf8', '#fbbf24', '#a78bfa', '#34d399', '#f472b6', '#fb923c'];

/** One-tap interval presets shown in Preferences. Seconds. */
export const PRESETS = [
  { id: 'classic', label: '25 / 5', sprint: 25 * 60, shortRest: 5 * 60, longRest: 15 * 60 },
  { id: 'starter', label: '15 / 3', sprint: 15 * 60, shortRest: 3 * 60, longRest: 10 * 60 },
  { id: 'deep', label: '50 / 10', sprint: 50 * 60, shortRest: 10 * 60, longRest: 30 * 60 },
  { id: 'marathon', label: '90 / 20', sprint: 90 * 60, shortRest: 20 * 60, longRest: 30 * 60 },
];

export const LIMITS = {
  nameLength: 20,
  questLength: 80,
  stoneLength: 80,
  maxStones: 100,
};

/** Room / peer sync tuning. */
export const SYNC = {
  heartbeatMs: 2000, // periodic presence broadcast
  peerTimeoutMs: 9000, // drop a peer card after this long without a packet
  followDriftMs: 1200, // re-align a following timer when drift exceeds this
  followGraceMs: 5000, // how long a follower waits at 00:00 for the host before advancing alone
  joinTimeoutMs: 12000,
  hostReclaimAttempts: 5,
  hostReclaimDelayMs: 2500,
};

/**
 * PeerJS options. WebRTC needs a signalling broker to introduce browsers to each
 * other; by default this is the free public PeerJS cloud (0.peerjs.com). Only
 * connection handshakes pass through it — timer/quest data flows peer-to-peer.
 *
 * To self-host a broker, set `window.RALLY_PEER_OPTIONS = { host, port, path, secure }`
 * in a script before js/app.js loads.
 */
export const PEER_OPTIONS = {
  debug: 0,
  pingInterval: 5000,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'turn:eu-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjspassword' },
      { urls: 'turn:us-0.turn.peerjs.com:3478', username: 'peerjs', credential: 'peerjspassword' },
    ],
  },
  ...(typeof window !== 'undefined' ? window.RALLY_PEER_OPTIONS || {} : {}),
};

export const ROOM_PREFIX = 'rally-';
/** Unambiguous alphabet for human-typed room codes (no 0/o, 1/l/i). */
export const ROOM_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const ROOM_CODE_LENGTH = 6;
