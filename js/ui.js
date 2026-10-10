/**
 * Rally - UI controller.
 * `render(state)` runs on real state changes; `renderClock(state, now)` runs on every
 * tick and touches only the digits, ring, title and favicon.
 */

import { getElapsedMs } from './state.js';
import { MODE_LABELS, PRESETS } from './config.js';
import { $, h, setText, setAttr, formatClock, formatDuration, formatWallClock } from './dom.js';
import { dynamicFavicon } from './favicon.js';
import { questView } from './quest-view.js';
import { peersView } from './peers-view.js';
import { peerSync, roomCodeFromId } from './peer-sync.js';

const CIRCUMFERENCE = 2 * Math.PI * 150;

class UIController {
  constructor() {
    this.root = document.documentElement;
    this.el = {
      nameInput: $('inline-name-input'),
      nameDot: $('name-dot'),
      roomBtn: $('room-btn'),
      roomLabel: $('room-status-indicator'),
      focusViewBtn: $('focus-view-btn'),
      followBanner: $('follow-banner'),
      followLabel: $('follow-label'),
      roundHud: $('round-hud-badge'),
      digits: $('timer-display'),
      modePill: $('session-mode-badge'),
      endsAt: $('ends-at'),
      dots: $('cycle-dots-container'),
      ring: $('progress-indicator'),
      resetBtn: $('reset-btn'),
      primaryBtn: $('primary-toggle-btn'),
      skipBtn: $('skip-btn'),
      linkToggle: $('toggle-sync-btn'),
      linkLabel: $('sync-status-label'),
      todayStats: $('today-stats'),
      questTitle: $('quest-title-input'),
      announcer: $('a11y-announcer'),
      settingsDialog: $('settings-dialog'),
      presetRow: $('preset-row'),
      roomDialog: $('room-dialog'),
    };
    this.dotsKey = '';
    this.lastMinuteAnnounced = null;
    this.state = null;
  }

  init() {
    this.el.ring.style.strokeDasharray = `${CIRCUMFERENCE}`;
    questView.init({ announce: (m) => this.announce(m) });
    peersView.init();
    this.buildPresets();
  }

  announce(message) {
    // Clear first so repeating the same message is still read out.
    this.el.announcer.textContent = '';
    requestAnimationFrame(() => { this.el.announcer.textContent = message; });
  }

  /* ============================ full render ============================ */

  render(state) {
    this.state = state;
    const { session, config, quest, room, profile, stats } = state;
    const following = Boolean(room.roomId && !room.isHost && room.hostLinked && room.followHost);

    setAttr(this.root, 'data-theme-mode', session.mode);
    setAttr(document.body, 'data-session-status', session.status);
    setAttr(document.body, 'data-focus-view', config.focusView);
    setAttr(this.el.focusViewBtn, 'aria-pressed', config.focusView);

    // Identity
    if (document.activeElement !== this.el.nameInput) this.el.nameInput.value = profile.displayName;
    document.body.style.setProperty('--me-color', profile.avatarColor);

    // Rounds
    const roundText = session.status === 'complete'
      ? 'Session complete'
      : `Round ${session.currentRound}${config.totalRounds > 0 ? ` of ${config.totalRounds}` : ''}`;
    setText(this.el.roundHud, roundText);
    setText(this.el.modePill, MODE_LABELS[session.mode]);
    this.el.modePill.hidden = session.status === 'complete';
    this.renderCycleDots(session, config);

    // Controls
    const labels = {
      running: ['Pause', `Pause ${MODE_LABELS[session.mode].toLowerCase()}`],
      paused: ['Resume', `Resume ${MODE_LABELS[session.mode].toLowerCase()}`],
      complete: ['New session', 'Start a new session'],
      idle: ['Start', `Start ${MODE_LABELS[session.mode].toLowerCase()}`],
    }[session.status];
    setText(this.el.primaryBtn, labels[0]);
    setAttr(this.el.primaryBtn, 'aria-label', labels[1]);
    const freshPhase = session.status === 'idle' && session.elapsedMs === 0;
    setAttr(this.el.resetBtn, 'aria-label', freshPhase || session.status === 'complete' ? 'Restart whole session from round 1' : 'Restart this phase');
    this.el.resetBtn.title = freshPhase ? 'Restart session (Alt+R)' : 'Restart phase (Alt+R)';
    for (const btn of [this.el.resetBtn, this.el.primaryBtn, this.el.skipBtn]) btn.disabled = following;
    this.el.skipBtn.disabled = following || session.status === 'complete';

    // Room-linked timers
    this.el.followBanner.hidden = !following;
    if (following) setText(this.el.followLabel, `Following ${room.hostName || 'the host'}'s timer`);
    this.el.linkToggle.hidden = !(room.roomId && room.isHost);
    setAttr(this.el.linkToggle, 'aria-pressed', room.linkTimers);
    setText(this.el.linkLabel, room.linkTimers ? "Everyone's timers follow yours" : "Link everyone's timers to mine");

    // Today
    setText(this.el.todayStats, stats.sprints || stats.focusMs >= 60000
      ? `Today · ${stats.sprints} sprint${stats.sprints === 1 ? '' : 's'} · ${formatDuration(stats.focusMs)} focused`
      : '');

    // Quest
    if (document.activeElement !== this.el.questTitle) this.el.questTitle.value = quest.title;
    questView.render(quest);

    // Room
    this.renderRoomButton(room);
    peersView.render(room.peers);
    if (this.el.roomDialog.open) this.renderRoomDialog(state);

    this.renderClock(state, Date.now());
  }

  renderCycleDots(session, config) {
    const cycle = Math.max(1, config.roundsBeforeLongRest);
    const position = ((session.currentRound - 1) % cycle) + 1;
    const key = `${cycle}|${position}|${session.mode}|${session.status}`;
    if (key === this.dotsKey) return;
    this.dotsKey = key;
    const dots = [];
    for (let i = 1; i <= cycle; i++) {
      const sprintDone = i < position || (i === position && session.mode !== 'sprint') || session.status === 'complete';
      const state = i === position && session.mode === 'sprint' && session.status !== 'complete' ? 'current' : sprintDone ? 'done' : 'todo';
      dots.push(h('span', { class: 'cycle-dot', dataset: { state } }));
    }
    this.el.dots.replaceChildren(...dots);
  }

  /* ============================ per-tick render ============================ */

  renderClock(state, now) {
    if (!state) return;
    const { session, config } = state;
    const elapsed = Math.min(session.durationMs, getElapsedMs(session, now));
    const remaining = session.durationMs - elapsed;
    const countUp = config.timerDirection === 'countup';

    const digits = session.status === 'complete' ? 'Done!' : countUp ? formatClock(elapsed, false) : formatClock(remaining);
    setText(this.el.digits, digits);

    const ratio = session.durationMs ? elapsed / session.durationMs : 0;
    this.el.ring.style.strokeDashoffset = `${CIRCUMFERENCE * (1 - ratio)}`;

    // "Ends at" makes the time concrete — helpful for time-blindness.
    let endsText;
    if (session.status === 'running') endsText = `Ends at ${formatWallClock(now + remaining)}`;
    else if (session.status === 'paused') endsText = `Paused · ${formatDuration(remaining)} left`;
    else if (session.status === 'complete') endsText = state.stats.focusMs ? `${formatDuration(state.stats.focusMs)} focused today` : 'Nice work';
    else endsText = `Start now → done at ${formatWallClock(now + remaining)}`;
    setText(this.el.endsAt, endsText);

    const running = session.status === 'running';
    const title = running ? `${countUp ? formatClock(elapsed, false) : formatClock(remaining)} · ${MODE_LABELS[session.mode]} · Rally` : session.status === 'paused' ? 'Paused · Rally' : 'Rally';
    if (document.title !== title) document.title = title;
    dynamicFavicon.update(ratio, session.mode, session.status === 'paused');

    // Screen-reader milestone: one minute left.
    if (running && remaining <= 60000 && remaining > 55000 && this.lastMinuteAnnounced !== session.mode + session.currentRound) {
      this.lastMinuteAnnounced = session.mode + session.currentRound;
      this.announce(`One minute left in this ${MODE_LABELS[session.mode].toLowerCase()}.`);
    }

    peersView.tick(now);
  }

  /* ============================== room ============================== */

  renderRoomButton(room) {
    const count = Object.keys(room.peers).length + 1;
    let status = room.connectionStatus;
    let label = 'Invite friends';
    if (room.roomId) {
      if (room.error && status === 'disconnected') {
        status = 'error';
        label = 'Room offline';
      } else if (status === 'connecting') label = 'Connecting…';
      else if (status === 'connected') label = count > 1 ? `${count} in room` : 'Room open';
      else label = 'Room offline';
    }
    setAttr(this.el.roomBtn, 'data-status', status);
    setText(this.el.roomLabel, label);
    setAttr(this.el.roomBtn, 'aria-label', room.roomId ? `Room: ${label}. Open room details` : 'Invite friends to focus together');
  }

  renderRoomDialog(state) {
    const { room, profile } = state;
    const inRoom = Boolean(room.roomId);
    $('room-solo').hidden = inRoom;
    $('room-active').hidden = !inRoom;
    $('room-footer').hidden = !inRoom;
    $('room-title').textContent = inRoom ? (room.isHost ? 'Your room' : 'Shared room') : 'Focus together';

    const err = $('room-error');
    err.hidden = !room.error;
    setText(err, room.error || '');

    if (!inRoom) return;

    setText($('display-room-code'), roomCodeFromId(room.roomId));
    const link = peerSync.inviteLink(room.roomId);
    if ($('share-link-input').value !== link) $('share-link-input').value = link;
    $('share-link-btn').hidden = !navigator.share;

    const count = Object.keys(room.peers).length + 1;
    const statusText = {
      connected: room.isHost
        ? (count > 1 ? `Live · ${count} people here` : 'Live · waiting for friends to join')
        : `Live · connected to ${room.hostName || 'host'}`,
      connecting: room.isHost ? 'Opening room…' : 'Connecting to the room…',
      disconnected: 'Not connected',
    }[room.connectionStatus];
    setText($('room-modal-status-text'), statusText);
    setAttr($('room-modal-status'), 'data-status', room.connectionStatus);
    $('retry-connection-btn').hidden = room.connectionStatus !== 'disconnected';

    const members = [
      h('li', { class: 'room-member', text: `${profile.displayName} (you)`, attrs: { style: `--member-color:${profile.avatarColor}` } }),
      ...Object.values(room.peers).map((p) => h('li', { class: 'room-member', text: p.isHost ? `${p.displayName} (host)` : p.displayName, attrs: { style: `--member-color:${p.avatarColor}` } })),
    ];
    $('room-members').replaceChildren(...members);

    $('room-host-link-row').hidden = !room.isHost;
    $('room-guest-follow-row').hidden = room.isHost;
    $('room-link-toggle').checked = room.linkTimers;
    $('room-follow-toggle').checked = room.followHost;
  }

  openRoom() {
    if (this.state) this.renderRoomDialog(this.state);
    if (!this.el.roomDialog.open) this.el.roomDialog.showModal();
    const focusTarget = this.state?.room.roomId ? $('copy-link-btn') : $('create-room-btn');
    focusTarget?.focus();
  }

  /* ============================== settings ============================== */

  buildPresets() {
    this.el.presetRow.replaceChildren(...PRESETS.map((p) => h('button', {
      type: 'button',
      class: 'chip-btn',
      dataset: { preset: p.id },
      text: p.label,
      title: `${p.sprint / 60} min sprints, ${p.shortRest / 60} min breaks, ${p.longRest / 60} min long rest`,
    })));
  }

  applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    this.setDurationFields('sprint', p.sprint);
    this.setDurationFields('short-rest', p.shortRest);
    this.setDurationFields('long-rest', p.longRest);
    this.syncPresetHighlight();
  }

  setDurationFields(prefix, seconds) {
    $(`${prefix}-min`).value = Math.floor(seconds / 60);
    $(`${prefix}-sec`).value = seconds % 60;
  }

  readDuration(prefix) {
    const m = Math.max(0, parseFloat($(`${prefix}-min`).value) || 0);
    const s = Math.max(0, parseFloat($(`${prefix}-sec`).value) || 0);
    return Math.max(1, Math.round(m * 60 + s));
  }

  syncPresetHighlight() {
    const sprint = this.readDuration('sprint');
    const shortRest = this.readDuration('short-rest');
    const longRest = this.readDuration('long-rest');
    for (const btn of this.el.presetRow.children) {
      const p = PRESETS.find((x) => x.id === btn.dataset.preset);
      setAttr(btn, 'aria-pressed', p.sprint === sprint && p.shortRest === shortRest && p.longRest === longRest);
    }
  }

  openSettings(config) {
    this.setDurationFields('sprint', config.sprintDurationSeconds);
    this.setDurationFields('short-rest', config.shortRestDurationSeconds);
    this.setDurationFields('long-rest', config.longRestDurationSeconds);
    $('rounds-before-long').value = config.roundsBeforeLongRest;
    $('total-rounds').value = config.totalRounds;
    $('auto-start-breaks').checked = config.autoStartBreaks;
    $('auto-start-sprints').checked = config.autoStartSprints;
    $('timer-direction-select').value = config.timerDirection;
    $('sound-toggle').checked = config.soundEnabled;
    $('sound-profile-select').value = config.soundProfile;
    $('notify-toggle').checked = config.notificationsEnabled && 'Notification' in window && Notification.permission === 'granted';
    $('notify-toggle').disabled = !('Notification' in window);
    this.syncPresetHighlight();
    this.el.settingsDialog.showModal();
  }

  readSettings() {
    return {
      sprintDurationSeconds: this.readDuration('sprint'),
      shortRestDurationSeconds: this.readDuration('short-rest'),
      longRestDurationSeconds: this.readDuration('long-rest'),
      roundsBeforeLongRest: parseInt($('rounds-before-long').value, 10) || 4,
      totalRounds: Math.max(0, parseInt($('total-rounds').value, 10) || 0),
      autoStartBreaks: $('auto-start-breaks').checked,
      autoStartSprints: $('auto-start-sprints').checked,
      timerDirection: $('timer-direction-select').value,
      soundEnabled: $('sound-toggle').checked,
      soundProfile: $('sound-profile-select').value,
      notificationsEnabled: $('notify-toggle').checked,
    };
  }
}

export const ui = new UIController();
