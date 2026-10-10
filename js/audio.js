/**
 * Rally - Web Audio synthesiser.
 * Zero-dependency cues in three profiles (Warm, Crisp, Minimal). Every cue is
 * synthesised on the fly, so there are no audio files to download or cache.
 */

import { store } from './state.js';

const NOTE = {
  C4: 261.63, G4: 392.0, A4: 440.0, C5: 523.25, E5: 659.25, F5: 698.46, G5: 783.99, C6: 1046.5,
};

class SoundEngine {
  constructor() {
    this.ctx = null;
  }

  /** Browsers only allow audio after a user gesture — call from click handlers. */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) this.ctx = new Ctx();
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    return Boolean(this.ctx);
  }

  get profile() {
    return store.getState().config.soundProfile || 'warm';
  }

  get enabled() {
    return store.getState().config.soundEnabled !== false;
  }

  tone(freq, start, duration, gainLevel = 0.2, type = null, profile = this.profile) {
    let oscType = type || 'sine';
    let attack = 0.025;
    let gainValue = gainLevel;
    if (profile === 'crisp') {
      oscType = type || 'triangle';
      attack = 0.008;
      gainValue *= 1.1;
    } else if (profile === 'minimal') {
      oscType = 'triangle';
      attack = 0.004;
      gainValue *= 0.85;
    }
    const decay = profile === 'minimal' ? Math.min(duration, 0.12) : duration;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = oscType;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(start);
    osc.stop(start + decay + 0.04);
  }

  /** Runs `fn(now)` only when sound is on and the context is available. */
  play(fn, { force = false } = {}) {
    if (!force && !this.enabled) return;
    if (!this.unlock()) return;
    fn(this.ctx.currentTime);
  }

  /* ------------------------------- cues ------------------------------- */

  previewProfile(name) {
    this.play((t) => {
      if (name === 'minimal') {
        this.tone(NOTE.C5, t, 0.08, 0.22, null, 'minimal');
        this.tone(NOTE.E5, t + 0.1, 0.1, 0.24, null, 'minimal');
      } else if (name === 'crisp') {
        this.tone(NOTE.C5, t, 0.18, 0.2, 'triangle', 'crisp');
        this.tone(NOTE.G5, t + 0.1, 0.4, 0.24, 'triangle', 'crisp');
      } else {
        this.tone(NOTE.C5, t, 0.6, 0.2, 'sine', 'warm');
        this.tone(NOTE.E5, t + 0.12, 0.8, 0.22, 'sine', 'warm');
      }
    }, { force: true });
  }

  /** Sprint finished → relaxing downward phrase. */
  playSprintComplete() {
    this.play((t) => {
      if (this.profile === 'minimal') {
        this.tone(NOTE.C5, t, 0.08, 0.2);
        this.tone(NOTE.G4, t + 0.12, 0.1, 0.22);
      } else if (this.profile === 'crisp') {
        this.tone(NOTE.F5, t, 0.4, 0.22, 'triangle');
        this.tone(NOTE.C5, t + 0.1, 0.5, 0.2, 'triangle');
        this.tone(NOTE.A4, t + 0.2, 0.8, 0.25, 'sine');
      } else {
        this.tone(NOTE.F5, t, 0.8, 0.22, 'sine');
        this.tone(NOTE.C5, t + 0.14, 0.9, 0.2, 'sine');
        this.tone(NOTE.A4, t + 0.3, 1.4, 0.25, 'sine');
      }
    });
  }

  /** Rest finished → energising rising triad. */
  playRestComplete() {
    this.play((t) => {
      if (this.profile === 'minimal') {
        this.tone(NOTE.A4, t, 0.08, 0.2);
        this.tone(NOTE.E5, t + 0.1, 0.1, 0.24);
      } else if (this.profile === 'crisp') {
        this.tone(NOTE.C5, t, 0.2, 0.2, 'triangle');
        this.tone(NOTE.E5, t + 0.08, 0.2, 0.22, 'triangle');
        this.tone(NOTE.G5, t + 0.16, 0.6, 0.26, 'sine');
      } else {
        this.tone(NOTE.C5, t, 0.5, 0.18, 'triangle');
        this.tone(NOTE.E5, t + 0.12, 0.5, 0.2, 'triangle');
        this.tone(NOTE.G5, t + 0.24, 1.2, 0.25, 'sine');
      }
    });
  }

  /** Long rest reached → celebratory chord. */
  playLongRestFanfare() {
    this.play((t) => {
      if (this.profile === 'minimal') {
        this.tone(NOTE.C5, t, 0.08, 0.2);
        this.tone(NOTE.E5, t + 0.09, 0.08, 0.22);
        this.tone(NOTE.G5, t + 0.18, 0.12, 0.24);
      } else if (this.profile === 'crisp') {
        this.tone(NOTE.C5, t, 0.25, 0.18, 'triangle');
        this.tone(NOTE.E5, t + 0.08, 0.25, 0.2, 'triangle');
        this.tone(NOTE.G5, t + 0.16, 0.3, 0.22, 'triangle');
        this.tone(NOTE.C6, t + 0.24, 1.0, 0.28, 'sine');
      } else {
        this.tone(NOTE.C5, t, 0.6, 0.16, 'triangle');
        this.tone(NOTE.E5, t + 0.1, 0.6, 0.18, 'triangle');
        this.tone(NOTE.G5, t + 0.2, 0.7, 0.2, 'triangle');
        this.tone(NOTE.C6, t + 0.32, 1.8, 0.26, 'sine');
        this.tone(NOTE.C4, t + 0.32, 1.6, 0.15, 'sine');
      }
    });
  }

  /** Whole session done → the fanfare, played twice-bright. */
  playSessionComplete() {
    this.playLongRestFanfare();
    this.play((t) => this.tone(NOTE.C6, t + 0.9, 1.2, 0.18, 'sine'));
  }

  /** Small reward when a stepping stone is ticked off. */
  playStepComplete() {
    this.play((t) => {
      this.tone(NOTE.E5, t, 0.12, 0.12, 'sine');
      this.tone(NOTE.G5, t + 0.07, 0.25, 0.14, 'sine');
    });
  }

  /** Tactile click for buttons. */
  playTactileClick() {
    this.play((t) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(360, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.035);
      gain.gain.setValueAtTime(0.04, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.04);
    });
  }
}

export const sound = new SoundEngine();
