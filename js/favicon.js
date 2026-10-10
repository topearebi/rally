/**
 * Rally - Dynamic favicon.
 * Draws the phase progress ring onto a tiny canvas so the browser tab shows progress
 * at a glance — handy when Rally sits in a background tab.
 */

import { MODE_COLORS } from './config.js';

class FaviconRenderer {
  constructor() {
    this.link = document.getElementById('favicon-link');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 64;
    this.ctx = this.canvas.getContext('2d');
    this.lastKey = '';
  }

  /**
   * @param {number} progress 0..1
   * @param {string} mode sprint | shortRest | longRest
   * @param {boolean} paused draws a pause glyph in the centre
   */
  update(progress, mode, paused = false) {
    const p = Math.round(Math.min(1, Math.max(0, progress)) * 60) / 60;
    const key = `${p}|${mode}|${paused}`;
    if (key === this.lastKey || !this.ctx) return;
    this.lastKey = key;

    const { ctx } = this;
    const { accent, bg } = MODE_COLORS[mode] || MODE_COLORS.sprint;
    ctx.clearRect(0, 0, 64, 64);

    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(32, 32, 22, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();

    if (p > 0) {
      ctx.beginPath();
      ctx.arc(32, 32, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
      ctx.strokeStyle = accent;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    if (paused) {
      ctx.fillStyle = accent;
      ctx.fillRect(25, 23, 5, 18);
      ctx.fillRect(34, 23, 5, 18);
    }

    if (this.link) this.link.href = this.canvas.toDataURL('image/png');
  }
}

export const dynamicFavicon = new FaviconRenderer();
