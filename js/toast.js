/**
 * Rally - Toasts with an optional action (used for Undo).
 * Gentle safety net for impulsive taps: deleting steps or replacing your list is undoable.
 */

import { $, h } from './dom.js';

const MAX_TOASTS = 3;

export function showToast(message, { actionLabel, onAction, duration = 5000 } = {}) {
  const region = $('toast-region');
  if (!region) return;

  while (region.children.length >= MAX_TOASTS) region.firstElementChild.remove();

  let timeoutId;
  const dismiss = () => {
    clearTimeout(timeoutId);
    toast.dataset.leaving = 'true';
    setTimeout(() => toast.remove(), 180);
  };

  const toast = h('div', { class: 'toast', attrs: { role: 'status' } },
    h('span', { class: 'toast-message', text: message }),
    actionLabel && h('button', {
      type: 'button',
      class: 'text-btn',
      text: actionLabel,
      on: { click: () => { onAction?.(); dismiss(); } },
    }),
  );

  region.append(toast);
  timeoutId = setTimeout(dismiss, duration);
  toast.addEventListener('pointerenter', () => clearTimeout(timeoutId));
  toast.addEventListener('pointerleave', () => { timeoutId = setTimeout(dismiss, 2500); });
}
