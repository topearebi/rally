/**
 * Rally - Tiny DOM & formatting helpers.
 */

export const $ = (id) => document.getElementById(id);

/**
 * Creates an element. `props` keys: class, text, dataset, attrs, on (event map), or any DOM property.
 * Children may be nodes, strings, or falsy (skipped).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'attrs') for (const [a, v] of Object.entries(value)) el.setAttribute(a, v);
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) el.addEventListener(ev, fn);
    else el[key] = value;
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Sets textContent only when it changed (avoids needless layout/AT churn). */
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

export function setAttr(el, name, value) {
  if (!el) return;
  const v = String(value);
  if (el.getAttribute(name) !== v) el.setAttribute(name, v);
}

/** mm:ss, or h:mm:ss for an hour or more. */
export function formatClock(ms, roundUp = true) {
  const total = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${String(minutes).padStart(2, '0')}:${ss}`;
}

/** "1h 15m", "25m", "40s". */
export function formatDuration(ms) {
  const totalMinutes = Math.floor(ms / 60000);
  if (totalMinutes < 1) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

export function formatWallClock(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export const icons = {
  up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
  close: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

/** Creates a button whose content is a trusted, static SVG from `icons`. */
export function iconButton(icon, props) {
  const btn = h('button', { type: 'button', ...props });
  btn.innerHTML = icons[icon];
  return btn;
}
