/**
 * Rally - Squad (room members) view.
 * Cards are created once per peer and patched in place, so buttons and open drawers
 * stay put while presence updates stream in. Peer clocks are extrapolated locally
 * between packets, so they tick smoothly without flooding the network.
 */

import { store } from './state.js';
import { $, h, setText, setAttr, formatClock } from './dom.js';

const SHORT_LABELS = { sprint: 'Sprint', shortRest: 'Rest', longRest: 'Long rest' };
import { showToast } from './toast.js';

export function peerElapsed(timer, now = Date.now()) {
  if (!timer) return 0;
  const extra = timer.status === 'running' ? now - timer.receivedAt : 0;
  return Math.min(timer.durationMs, timer.elapsedMs + extra);
}

class PeersView {
  constructor() {
    this.section = $('peer-section');
    this.grid = $('peer-grid');
    this.title = $('peer-section-title');
    this.cards = new Map(); // peerId -> { el, refs, stonesSig, data }
  }

  init() {
    this.grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="copy"]');
      if (!btn) return;
      const entry = this.cards.get(btn.closest('[data-peer-id]')?.dataset.peerId);
      const stones = entry?.data.quest?.stones;
      if (!stones?.length) return;

      const previous = store.importSteppingStones(stones, entry.data.quest.title);
      if (!previous) return;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { btn.textContent = 'Use these steps'; }, 2000);
      showToast(`Copied ${entry.data.displayName}'s ${stones.length} steps into your quest.`, {
        actionLabel: 'Undo',
        onAction: () => store.restoreQuest(previous),
        duration: 7000,
      });
    });
  }

  render(peers) {
    const entries = Object.entries(peers);
    this.section.hidden = entries.length === 0;
    setText(this.title, entries.length ? `Squad · ${entries.length + 1} focusing together` : 'Squad');

    for (const [id, entry] of this.cards) {
      if (!peers[id]) {
        entry.el.remove();
        this.cards.delete(id);
      }
    }
    for (const [id, data] of entries) this.upsert(id, data);
  }

  upsert(id, data) {
    let entry = this.cards.get(id);
    if (!entry) {
      entry = this.create(id);
      this.cards.set(id, entry);
      this.grid.append(entry.el);
    }
    entry.data = data;
    const { el, refs } = entry;
    const quest = data.quest || { title: '', stones: [] };
    const stones = quest.stones || [];
    const done = stones.filter((s) => s.completed).length;
    const current = stones.find((s) => !s.completed);
    const pct = stones.length ? Math.round((done / stones.length) * 100) : 0;

    el.style.setProperty('--peer-accent', data.avatarColor);
    setText(refs.name, data.displayName);
    refs.hostBadge.hidden = !data.isHost;
    setText(refs.quest, quest.title || 'No quest set');
    setText(refs.step, current ? `→ ${current.text}` : stones.length ? 'All steps done ✓' : 'No steps yet');
    refs.fill.style.width = `${pct}%`;

    const sprints = data.stats?.sprints || 0;
    const parts = [`${done}/${stones.length} steps`];
    if (sprints) parts.push(`${sprints} sprint${sprints === 1 ? '' : 's'} today`);
    setText(refs.stats, parts.join(' · '));

    refs.copy.hidden = stones.length === 0;
    refs.drawer.hidden = stones.length === 0;

    const sig = JSON.stringify(stones);
    if (sig !== entry.stonesSig) {
      entry.stonesSig = sig;
      setText(refs.summary, `See their steps (${stones.length})`);
      refs.list.replaceChildren(...stones.map((s) => h('li', {
        class: 'peer-preview-item',
        dataset: { completed: String(s.completed), active: String(s === current) },
      }, h('span', { attrs: { 'aria-hidden': 'true' }, text: s.completed ? '✓' : s === current ? '→' : '·' }), h('span', { text: s.text }))));
    }

    this.tickCard(entry);
  }

  create(id) {
    const refs = {
      name: h('span', { class: 'peer-name' }),
      hostBadge: h('span', { class: 'peer-host-badge', text: 'host' }),
      mode: h('span', { class: 'peer-mode' }),
      time: h('span', { class: 'numeric-tabular' }),
      quest: h('div', { class: 'peer-quest' }),
      step: h('div', { class: 'peer-active-stone' }),
      fill: h('div', { class: 'peer-progress-fill' }),
      stats: h('span', { class: 'peer-stats-badge numeric-tabular' }),
      copy: h('button', { type: 'button', class: 'chip-btn', dataset: { action: 'copy' }, text: 'Use these steps', title: "Replace your steps with a copy of theirs (undoable)" }),
      summary: h('summary', { class: 'peer-stones-summary' }),
      list: h('ul', { class: 'peer-stone-preview-list' }),
    };
    refs.drawer = h('details', { class: 'peer-stones-drawer' }, refs.summary, refs.list);

    const el = h('article', { class: 'peer-card', dataset: { peerId: id } },
      h('div', { class: 'peer-card-header' }, refs.name, refs.hostBadge, h('span', { class: 'peer-timer' }, refs.mode, refs.time)),
      refs.quest,
      refs.step,
      h('div', { class: 'peer-progress-bar', attrs: { 'aria-hidden': 'true' } }, refs.fill),
      h('div', { class: 'peer-footer-row' }, refs.stats, refs.copy),
      refs.drawer,
    );
    return { el, refs, stonesSig: '', data: {} };
  }

  tickCard(entry, now = Date.now()) {
    const t = entry.data.timer;
    if (!t) return;
    const { mode, time } = entry.refs;
    const status = t.status;
    setAttr(mode, 'data-mode', t.mode);
    setAttr(mode, 'data-status', status);
    const label = status === 'complete' ? 'Done' : status === 'paused' ? 'Paused' : status === 'idle' ? 'Ready' : SHORT_LABELS[t.mode];
    setText(mode, label);
    setText(time, status === 'complete' ? '' : formatClock(t.durationMs - peerElapsed(t, now)));
  }

  /** Called on every clock tick to keep peer timers moving between packets. */
  tick(now) {
    for (const entry of this.cards.values()) this.tickCard(entry, now);
  }
}

export const peersView = new PeersView();
