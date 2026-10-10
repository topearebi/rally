/**
 * Rally - Quest & stepping stones view.
 * Re-renders only when the quest actually changes, never while you're typing in it,
 * and handles all clicks through delegation so a re-render can't swallow a tap.
 */

import { store } from './state.js';
import { sound } from './audio.js';
import { $, h, setText, iconButton } from './dom.js';
import { showToast } from './toast.js';

class QuestView {
  constructor() {
    this.card = document.querySelector('.quest-card');
    this.counter = $('stones-counter');
    this.progressFill = $('quest-progress-fill');
    this.spotlight = $('active-stone-container');
    this.upcomingDrawer = $('upcoming-stones-drawer');
    this.upcomingList = $('stepping-stones-list');
    this.upcomingBadge = $('upcoming-count-badge');
    this.completedDrawer = $('completed-stones-drawer');
    this.completedList = $('completed-stones-list');
    this.completedBadge = $('completed-count-badge');
    this.clearCompletedBtn = $('clear-completed-btn');
    this.lastSignature = '';
    this.pendingQuest = null;
    this.announce = () => {};
  }

  init({ announce }) {
    this.announce = announce;
    const regions = [this.spotlight, this.upcomingList, this.completedList];

    for (const region of regions) {
      region.addEventListener('change', (e) => this.onChange(e));
      region.addEventListener('click', (e) => this.onClick(e));
      region.addEventListener('keydown', (e) => this.onKeydown(e));
      // A deferred render (skipped while editing) runs once focus leaves the list.
      region.addEventListener('focusout', () => {
        requestAnimationFrame(() => {
          if (this.pendingQuest && !this.isEditing()) this.render(this.pendingQuest, true);
        });
      });
    }

    this.clearCompletedBtn.addEventListener('click', () => {
      const snapshot = structuredClone(store.getState().quest);
      const removed = store.clearCompletedStones();
      if (removed) {
        showToast(`Cleared ${removed} done step${removed === 1 ? '' : 's'}.`, {
          actionLabel: 'Undo',
          onAction: () => store.restoreQuest(snapshot),
        });
      }
    });
  }

  isEditing() {
    const el = document.activeElement;
    return el?.matches?.('.stone-text-input, .active-stone-input') && this.card.contains(el);
  }

  stoneIdFrom(el) {
    return el.closest('[data-stone-id]')?.dataset.stoneId;
  }

  /* ------------------------------ events ------------------------------ */

  onChange(e) {
    const id = this.stoneIdFrom(e.target);
    if (!id) return;

    if (e.target.matches('.stone-checkbox')) {
      const nowDone = store.toggleSteppingStone(id);
      if (nowDone) {
        sound.playStepComplete();
        const next = store.getState().quest.stones.find((s) => !s.completed);
        this.announce(next ? `Step done. Next up: ${next.text}` : 'All steps done. Nice work!');
        requestAnimationFrame(() => {
          const card = this.spotlight.firstElementChild;
          card?.classList.remove('celebrate');
          void card?.offsetWidth;
          card?.classList.add('celebrate');
        });
      }
    } else if (e.target.matches('.stone-text-input, .active-stone-input')) {
      const value = e.target.value.trim();
      const stone = store.getState().quest.stones.find((s) => s.id === id);
      if (!value && stone) e.target.value = stone.text; // empty edit = revert
      else store.updateSteppingStone(id, value);
    }
  }

  onClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = this.stoneIdFrom(btn);
    if (!id) return;
    const action = btn.dataset.action;

    if (action === 'up' || action === 'down') {
      store.moveSteppingStone(id, action);
      // Keep keyboard focus on the moved item's button.
      requestAnimationFrame(() => {
        const again = this.card.querySelector(`[data-stone-id="${CSS.escape(id)}"] [data-action="${action}"]`);
        (again && !again.disabled ? again : this.card.querySelector(`[data-stone-id="${CSS.escape(id)}"] .stone-checkbox`))?.focus();
      });
    } else if (action === 'delete') {
      const result = store.deleteSteppingStone(id);
      if (result) {
        showToast(`Deleted “${result.stone.text}”`, {
          actionLabel: 'Undo',
          onAction: () => {
            const quest = structuredClone(store.getState().quest);
            quest.stones.splice(result.index, 0, result.stone);
            store.restoreQuest(quest);
          },
        });
      }
    }
  }

  onKeydown(e) {
    if (!e.target.matches('.stone-text-input, .active-stone-input')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    } else if (e.key === 'Escape') {
      const stone = store.getState().quest.stones.find((s) => s.id === this.stoneIdFrom(e.target));
      if (stone) e.target.value = stone.text;
      e.target.blur();
      e.stopPropagation();
    }
  }

  /* ------------------------------ render ------------------------------ */

  render(quest, force = false) {
    const signature = JSON.stringify(quest.stones);
    if (!force && signature === this.lastSignature) return;
    if (this.isEditing()) {
      this.pendingQuest = quest;
      return;
    }
    this.pendingQuest = null;
    this.lastSignature = signature;

    const done = quest.stones.filter((s) => s.completed);
    const pending = quest.stones.filter((s) => !s.completed);
    const total = quest.stones.length;

    setText(this.counter, `${done.length}/${total}`);
    this.counter.setAttribute('aria-label', `${done.length} of ${total} steps done`);
    this.progressFill.style.width = `${total ? (done.length / total) * 100 : 0}%`;

    this.spotlight.replaceChildren(this.renderSpotlight(pending, total));

    const upcoming = pending.slice(1);
    setText(this.upcomingBadge, String(upcoming.length));
    this.upcomingDrawer.hidden = upcoming.length === 0;
    this.upcomingList.replaceChildren(...upcoming.map((stone, i) => this.renderItem(stone, false, i === upcoming.length - 1)));

    setText(this.completedBadge, String(done.length));
    this.completedDrawer.hidden = done.length === 0;
    this.completedList.replaceChildren(...done.map((stone) => this.renderItem(stone)));
  }

  renderSpotlight(pending, total) {
    if (!pending.length) {
      return total
        ? h('div', { class: 'empty-quest' }, h('strong', { text: 'Every step done 🎉' }), 'Add another step, or celebrate and take a break.')
        : h('div', { class: 'empty-quest' }, h('strong', { text: 'Break it into tiny steps' }), 'Add the first small step below. You only need to see the next one.');
    }

    const stone = pending[0];
    return h('div', { class: 'active-stone-card', dataset: { stoneId: stone.id } },
      h('input', { type: 'checkbox', class: 'stone-checkbox', attrs: { 'aria-label': `Mark current step done: ${stone.text}` } }),
      h('div', { class: 'active-stone-body' },
        h('span', { class: 'active-stone-label', text: 'Current step' }),
        h('input', { type: 'text', class: 'active-stone-input', value: stone.text, maxLength: 80, attrs: { 'aria-label': 'Edit current step' } }),
      ),
      h('div', { class: 'stone-actions' },
        iconButton('down', { class: 'stone-action-btn', disabled: pending.length < 2, dataset: { action: 'down' }, title: 'Not now — do this later', attrs: { 'aria-label': `Move “${stone.text}” later` } }),
        iconButton('close', { class: 'stone-action-btn', dataset: { action: 'delete' }, title: 'Delete step', attrs: { 'aria-label': `Delete “${stone.text}”` } }),
      ),
    );
  }

  /** The first upcoming item may move "up" — that swaps it with the current step. */
  renderItem(stone, isTop = false, isBottom = false) {
    return h('li', { class: 'stone-item', dataset: { stoneId: stone.id } },
      h('input', { type: 'checkbox', class: 'stone-checkbox', checked: stone.completed, attrs: { 'aria-label': `${stone.completed ? 'Mark not done' : 'Mark done'}: ${stone.text}` } }),
      h('input', { type: 'text', class: 'stone-text-input', value: stone.text, maxLength: 80, attrs: { 'aria-label': `Edit step: ${stone.text}` } }),
      h('div', { class: 'stone-actions' },
        !stone.completed && iconButton('up', { class: 'stone-action-btn', disabled: isTop, dataset: { action: 'up' }, title: 'Move up', attrs: { 'aria-label': `Move “${stone.text}” up` } }),
        !stone.completed && iconButton('down', { class: 'stone-action-btn', disabled: isBottom, dataset: { action: 'down' }, title: 'Move down', attrs: { 'aria-label': `Move “${stone.text}” down` } }),
        iconButton('close', { class: 'stone-action-btn', dataset: { action: 'delete' }, title: 'Delete', attrs: { 'aria-label': `Delete “${stone.text}”` } }),
      ),
    );
  }
}

export const questView = new QuestView();
