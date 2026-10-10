/**
 * Rally - Bootstrap.
 * Wires the store, timer engine, room sync and views together and binds user input.
 * Broadcasting to the room is automatic: any local change that affects what friends
 * see is sent by peer-sync's store subscription, so handlers here never call it.
 */

import { store } from './state.js';
import { timer } from './timer.js';
import { sound } from './audio.js';
import { peerSync } from './peer-sync.js';
import { ui } from './ui.js';
import { $ } from './dom.js';
import { showToast } from './toast.js';

const click = (id, fn) => $(id)?.addEventListener('click', fn);

function bindTimerControls() {
  click('primary-toggle-btn', () => {
    sound.playTactileClick();
    if (store.getState().session.status === 'complete') {
      store.reset();
      ui.announce('New session ready. Round 1.');
    } else {
      timer.toggle();
    }
  });

  click('reset-btn', () => {
    sound.playTactileClick();
    const before = structuredClone(store.getState().session);
    const what = timer.reset();
    if (what === 'session' && (before.currentRound > 1 || before.mode !== 'sprint')) {
      showToast('Restarted from round 1.', { actionLabel: 'Undo', onAction: () => store.restoreSession(before) });
    } else if (what === 'phase' && before.elapsedMs + (before.anchorTs ? Date.now() - before.anchorTs : 0) > 5000) {
      showToast('Phase restarted.', { actionLabel: 'Undo', onAction: () => store.restoreSession(before) });
    }
    ui.announce(what === 'session' ? 'Session restarted from round 1.' : 'Phase restarted.');
  });

  click('skip-btn', () => {
    sound.unlock();
    timer.skip();
  });

  timer.onTransition((message) => ui.announce(message));
}

function bindIdentityAndQuest() {
  const name = $('inline-name-input');
  const commitName = () => {
    if (name.value.trim()) store.updateProfile({ displayName: name.value });
    else name.value = store.getState().profile.displayName;
  };
  name.addEventListener('change', commitName);
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') name.blur();
    if (e.key === 'Escape') {
      name.value = store.getState().profile.displayName;
      name.blur();
    }
  });

  const title = $('quest-title-input');
  title.addEventListener('input', () => store.setQuestTitle(title.value));
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('new-stone-input').focus();
  });

  const form = $('add-stone-form');
  const input = $('new-stone-input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    if (store.addSteppingStone(input.value)) {
      sound.playTactileClick();
      input.value = '';
    } else {
      showToast('That list is full — try finishing or clearing a few steps.');
    }
  });

  click('focus-view-btn', () => toggleFocusView());
}

function toggleFocusView() {
  const next = !store.getState().config.focusView;
  store.updateConfig({ focusView: next });
  ui.announce(next ? 'Focus view on. Only the timer and current step are shown.' : 'Focus view off.');
}

function bindDialogs() {
  // Shared: [data-close-dialog] buttons, and clicking the dimmed backdrop.
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-dialog]') || e.target === dialog) dialog.close();
    });
  });

  /* ------------------------------ Preferences ------------------------------ */
  click('open-settings-btn', () => ui.openSettings(store.getState().config));

  $('preset-row').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (btn) ui.applyPreset(btn.dataset.preset);
  });
  $('settings-form').addEventListener('input', (e) => {
    if (e.target.matches('[id$="-min"], [id$="-sec"]')) ui.syncPresetHighlight();
  });
  click('preview-sound-btn', () => sound.previewProfile($('sound-profile-select').value));

  $('notify-toggle').addEventListener('change', async (e) => {
    if (!e.target.checked || !('Notification' in window) || Notification.permission === 'granted') return;
    const result = await Notification.requestPermission().catch(() => 'denied');
    if (result !== 'granted') {
      e.target.checked = false;
      showToast('Notifications are blocked for this site in your browser settings.');
    }
  });

  $('settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    store.updateConfig(ui.readSettings());
    $('settings-dialog').close();
    showToast('Preferences saved.', { duration: 2200 });
  });

  /* ------------------------------ Room ------------------------------ */
  click('room-btn', () => ui.openRoom());

  $('room-dialog').addEventListener('close', () => {
    const { room } = store.getState();
    if (room.error && !room.roomId) store.setRoom({ error: null });
  });

  click('create-room-btn', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Opening…';
    try {
      await peerSync.createRoom();
      ui.renderRoomDialog(store.getState());
      $('copy-link-btn').focus();
    } catch (_) {
      /* error is shown in the dialog */
    } finally {
      btn.disabled = false;
      btn.textContent = 'Start a room';
    }
  });

  $('join-room-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('join-code-input');
    const btn = $('join-room-btn');
    btn.disabled = true;
    btn.textContent = 'Joining…';
    try {
      await peerSync.joinRoom(input.value);
      input.value = '';
    } catch (err) {
      store.setRoom({ error: err.message });
      input.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Join';
    }
  });

  click('copy-link-btn', async (e) => {
    const btn = e.currentTarget;
    const field = $('share-link-input');
    try {
      await navigator.clipboard.writeText(field.value);
    } catch (_) {
      field.select();
      document.execCommand('copy');
    }
    btn.textContent = 'Copied ✓';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });

  click('share-link-btn', () => {
    navigator.share?.({ title: 'Focus with me on Rally', text: 'Join my Rally room so we can focus together:', url: $('share-link-input').value }).catch(() => {});
  });

  click('retry-connection-btn', () => peerSync.reconnect().catch(() => {}));

  click('leave-room-btn', () => {
    peerSync.leaveRoom();
    showToast('You left the room. Your timer and steps are untouched.');
  });

  const setLink = (on) => {
    store.setRoom({ linkTimers: on });
    ui.announce(on ? "Linked. Everyone's timers now follow yours." : 'Unlinked. Everyone runs their own timer.');
  };
  click('toggle-sync-btn', () => setLink(!store.getState().room.linkTimers));
  $('room-link-toggle').addEventListener('change', (e) => setLink(e.target.checked));

  $('room-follow-toggle').addEventListener('change', (e) => store.setRoom({ followHost: e.target.checked }));
  click('unfollow-btn', () => {
    store.setRoom({ followHost: false });
    showToast("You're on your own timer now.", { actionLabel: 'Follow again', onAction: () => store.setRoom({ followHost: true }) });
  });
}

function bindKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    if (t.closest?.('input, select, textarea, [contenteditable="true"]')) return;

    if (e.code === 'Space' && !e.altKey) {
      // Let a focused button / disclosure handle its own Space press.
      if (t.closest?.('button, summary, a')) return;
      e.preventDefault();
      $('primary-toggle-btn').click();
    } else if (e.altKey && e.code === 'KeyR') {
      e.preventDefault();
      $('reset-btn').click();
    } else if (e.altKey && e.code === 'KeyS') {
      e.preventDefault();
      $('skip-btn').click();
    } else if (!e.altKey && e.code === 'KeyF') {
      e.preventDefault();
      toggleFocusView();
    } else if (!e.altKey && e.code === 'KeyN') {
      e.preventDefault();
      if (store.getState().config.focusView) toggleFocusView();
      $('new-stone-input').focus();
    }
  });
}

function joinFromHash() {
  const match = location.hash.match(/room=([A-Za-z0-9_-]+)/);
  if (!match) return;
  const { roomId } = store.getState().room;
  if (roomId && roomId.endsWith(match[1].replace(/^rally-/, ''))) return;
  peerSync.joinRoom(match[1]).catch(() => ui.openRoom());
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  });
}

function boot() {
  ui.init();
  store.subscribe((state) => ui.render(state));
  timer.onTick((_state, now) => ui.renderClock(store.getState(), now));
  timer.init();
  peerSync.init();

  bindTimerControls();
  bindIdentityAndQuest();
  bindDialogs();
  bindKeyboardShortcuts();

  joinFromHash();
  window.addEventListener('hashchange', joinFromHash);
  registerServiceWorker();
}

boot();
