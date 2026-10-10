# Rally

A focus timer built for body doubling. You set your intervals, break a goal into small steps, and share a room link so friends can focus alongside you in real time. It's designed with ADHD brains in mind: one current step in the spotlight, concrete "ends at" times, gentle sounds, and undo for impulsive taps.

Rally is plain HTML, CSS and ES modules. There is no build step and no account, and the app runs from GitHub Pages.

## Features

- **Intervals:** sprints, short rests and long rests, with a target number of rounds, auto-start options and one-tap presets (25/5, 15/3, 50/10, 90/20).
- **Quest and stepping stones:** one goal and the steps to get there. Only the *current step* is highlighted. You can tap "Not now" to push it later, reorder steps, edit them inline, and undo deletes.
- **Rooms:** start a room and share the link or 6-character code. Everyone sees each other's timer, quest, current step and how many sprints they've done today. You can "Use these steps" to copy a friend's checklist (undoable).
- **Linked timers:** the host can link everyone's timers so start, pause and phase changes happen together. Guests can choose "Go independent" at any time.
- **Time-blindness helpers:** "Ends at 3:42 PM", a progress favicon in the browser tab, the timer in the tab title, and optional system notifications when Rally is in the background.
- **Focus view (`F`):** hides everything except the timer and the current step.
- **Works offline and installs as an app (PWA).** The screen stays awake while the timer runs.

Keyboard shortcuts: `Space` start/pause · `Alt+R` restart · `Alt+S` skip · `F` focus view · `N` new step.

## How it's built

```
index.html            markup only (no inline styles)
css/tokens.css        colours, type, spacing; one accent colour per phase
css/base.css          resets and accessibility utilities
css/components.css    all component styles
js/app.js             bootstrap and event wiring
js/state.js           store, persistence (localStorage) and timing model
js/timer.js           ticker, phase completion, cues, notifications, wake lock
js/worker.js          background ticker (less throttled in hidden tabs)
js/peer-sync.js       rooms over WebRTC (PeerJS)
js/ui.js              header, timer, controls, dialogs
js/quest-view.js      quest and steps (keyed, delegated events)
js/peers-view.js      squad cards (patched in place)
js/audio.js           synthesised sound cues (no audio files)
js/favicon.js         progress ring favicon
js/config.js          tunables: presets, colours, sync timings, broker config
vendor/peerjs.min.js  PeerJS 1.5.4 (MIT), vendored so there's no CDN dependency
sw.js                 network-first offline cache
```

**Timing model.** A phase is stored as `durationMs`, `elapsedMs` and `anchorTs`, the wall-clock time when elapsed was zero. Elapsed time is always derived from the clock, so:

- the store doesn't change on every tick,
- reloading keeps your place,
- countdown vs count-up is just a display setting.

**Rooms.** The room code is the host's peer ID, and the room is a star around the host. Each guest keeps a single connection to the host, and the host relays everyone's presence to the others. Peer clocks are extrapolated locally between packets. If the host reloads, Rally re-claims the same room code and guests reconnect automatically.

**Signalling.** Browsers need a broker to find each other. By default this is the free public PeerJS server. Only the handshake goes through it; room data flows directly between browsers and nothing is stored anywhere. PeerJS only loads when you open a room, so solo use makes no network requests at all. To use your own broker, add this to `index.html` before `js/app.js`:

```html
<script>window.RALLY_PEER_OPTIONS = { host: 'peer.example.com', port: 443, path: '/rally', secure: true };</script>
```

## Deploying

Push to the branch GitHub Pages serves. When you change the list of files in `sw.js`, bump `CACHE_VERSION`.

Saves from the previous version (`rally_state_v4`) are migrated automatically.
