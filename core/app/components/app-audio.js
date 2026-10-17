import { html, nothing } from '../../kit/lit.js';
import { KitElement } from '../../kit/element.js';
import { press } from '../../kit/press.js';
import { clock, progressOf, flatWave, wavePeaks, barsDone, seekAt, seekByKey, isUnplayed, decodePlayed, encodePlayed, PLAYED_KEY, WAVE_BARS, WAVE_DECODE_MAX_BYTES } from '../rules/audio.js';

// A recording in a conversation, played where it was sent (issue 432): a play and pause control, the waveform,
// which fills as it plays and moves to where it is pressed, how far in it is and how long it runs, and a mark on one
// someone else sent until it is played. What to draw is core/app/rules/audio.js; this element fetches the file, reads
// its waveform, plays it and remembers what was played on this device.

// What has been played on this device, read once from the shell's storage and kept for the life of the page. A page
// with no shell keeps it for the page only.
let playedIds = null;
export function playedOnDevice({ bridge = globalThis.window?.bridge } = {}) {
  if (!playedIds) {
    playedIds = (async () => {
      try { return new Set(decodePlayed(await bridge?.call('storage.get', { key: PLAYED_KEY }))); } catch { return new Set(); }
    })();
  }
  return playedIds;
}
export async function rememberPlayed(id, { bridge = globalThis.window?.bridge } = {}) {
  const set = await playedOnDevice({ bridge });
  const key = String(id);
  if (set.has(key)) return set;
  set.add(key);
  try { await bridge?.call('storage.set', { key: PLAYED_KEY, value: encodePlayed([...set]) }); } catch { /* page only */ }
  return set;
}
// For a test: forget what was read, so the next read asks the shell again.
export function forgetPlayed() {
  playedIds = null;
}

// One recording plays at a time: starting one pauses whichever was playing.
let playingNow = null;

// The waveform of the file's own samples, read by the web view's audio decoder. A file it cannot decode, one too large
// to hold decoded, or a page with no decoder keeps the even waveform.
async function readWave(blob) {
  const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Context || !blob || !(blob.size <= WAVE_DECODE_MAX_BYTES)) return null;
  let context = null;
  try {
    context = new Context();
    const buffer = await blob.arrayBuffer();
    const decoded = await new Promise((resolve, reject) => {
      const done = context.decodeAudioData(buffer, resolve, reject);
      if (done && typeof done.then === 'function') done.then(resolve, reject);
    });
    const channels = [];
    for (let i = 0; i < decoded.numberOfChannels; i += 1) channels.push(decoded.getChannelData(i));
    return wavePeaks(channels, WAVE_BARS);
  } catch {
    return null;
  } finally {
    try { await context?.close?.(); } catch { /* already closed */ }
  }
}

class AppAudio extends KitElement {
  static properties = {
    attachment: { attribute: false },
    client: { attribute: false },
    mine: { attribute: false },
    src: { state: true },
    playing: { state: true },
    position: { state: true },
    length: { state: true },
    wave: { state: true },
    heard: { state: true },
  };

  constructor() {
    super();
    this.mine = false;
    this.src = '';
    this.playing = false;
    this.position = 0;
    this.length = 0;
    this.wave = flatWave();
    this.heard = null;
  }

  connectedCallback() {
    super.connectedCallback();
    playedOnDevice().then((set) => { this.heard = set; });
    if (this.hasUpdated && !this.src) this.fetchWhenSeen();
  }

  firstUpdated() {
    if (!this.src) this.fetchWhenSeen();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.watch?.disconnect();
    this.request?.abort();
    this.request = null;
    this.loading = null;
    this.player()?.pause?.();
    if (playingNow === this) playingNow = null;
  }

  updated(changed) {
    const before = changed.get('attachment');
    if (changed.has('attachment') && before && before.id !== this.attachment?.id) {
      this.request?.abort();
      this.request = null;
      this.loading = null;
      if (this.src) URL.revokeObjectURL(this.src);
      this.src = '';
      this.playing = false;
      this.position = 0;
      this.length = 0;
      this.wave = flatWave();
      this.fetchWhenSeen();
    }
  }

  player() {
    return this.querySelector('audio');
  }

  // The file is asked for when its row comes within a screen of the view, as a picture is, so its length and waveform
  // are there before it is reached and a press plays at once.
  fetchWhenSeen() {
    if (typeof IntersectionObserver !== 'function' || !this.isConnected) {
      this.load();
      return;
    }
    if (!this.watch) {
      this.watch = new IntersectionObserver((entries) => {
        if (!entries.some((x) => x.isIntersecting)) return;
        this.watch.disconnect();
        if (!this.src) this.load();
      }, { rootMargin: '100% 0px' });
    }
    this.watch.disconnect();
    this.watch.observe(this);
  }

  // The file, fetched once, and its waveform read from it. A file that cannot be fetched or played is a failure, which
  // the attachment answers by drawing it as a file card.
  load() {
    const a = this.attachment;
    if (!a || !this.client) return Promise.resolve(null);
    if (this.src) return Promise.resolve(this.src);
    if (this.loading && this.loading.id === a.id) return this.loading.done;
    const request = new AbortController();
    this.request = request;
    const done = (async () => {
      try {
        const blob = await this.client.attachment(a.id, { signal: request.signal });
        if (request.signal.aborted || this.attachment?.id !== a.id) return null;
        this.src = URL.createObjectURL(blob);
        readWave(blob).then((wave) => { if (wave && this.attachment?.id === a.id) this.wave = wave; });
        return this.src;
      } catch {
        if (!request.signal.aborted && this.attachment?.id === a.id) this.fail();
        return null;
      } finally {
        if (this.request === request) this.request = null;
      }
    })();
    this.loading = { id: a.id, done };
    return done;
  }

  fail() {
    this.dispatchEvent(new CustomEvent('audio-failed', { bubbles: true, composed: true, detail: { attachmentId: this.attachment?.id || '' } }));
  }

  // Play or pause. Playing waits for the file when it has not arrived yet, and pauses whichever recording was playing.
  async toggle() {
    if (this.playing) {
      this.player()?.pause();
      return undefined;
    }
    if (!this.src) await this.load();
    await this.updateComplete;
    const audio = this.player();
    if (!audio) return undefined;
    if (playingNow && playingNow !== this) playingNow.player()?.pause();
    playingNow = this;
    return audio.play();
  }

  onPlay() {
    this.playing = true;
    if (playingNow && playingNow !== this) playingNow.player()?.pause();
    playingNow = this;
    if (this.attachment) rememberPlayed(this.attachment.id).then((set) => { this.heard = set; this.requestUpdate(); });
  }

  onPause() {
    this.playing = false;
    if (playingNow === this) playingNow = null;
  }

  // At the end it goes back to the start, ready to play again, as a voice message does.
  onEnded() {
    this.onPause();
    const audio = this.player();
    if (audio) audio.currentTime = 0;
    this.position = 0;
  }

  onTime(e) {
    this.position = Number(e.target.currentTime) || 0;
  }

  onLength(e) {
    const d = Number(e.target.duration);
    if (Number.isFinite(d) && d > 0) this.length = d;
  }

  moveTo(seconds) {
    const audio = this.player();
    if (seconds === null || !audio) return;
    audio.currentTime = seconds;
    this.position = seconds;
  }

  seekPress(e) {
    const r = e.currentTarget.getBoundingClientRect();
    this.moveTo(seekAt(e.clientX, r.left, r.width, this.length));
  }

  seekKey(e) {
    const to = seekByKey(e.key, this.position, this.length);
    if (to === null) return;
    e.preventDefault();
    this.moveTo(to);
  }

  render() {
    const a = this.attachment;
    if (!a) return nothing;
    const name = String(a.name || 'Audio');
    const filled = barsDone(progressOf(this.position, this.length), this.wave.length);
    const unplayed = isUnplayed(a, { mine: this.mine, played: this.heard });
    const elapsed = clock(this.position);
    const total = clock(this.length);
    return html`<div class="voice-note" data-playing=${this.playing ? 'true' : 'false'} data-unplayed=${unplayed ? 'true' : 'false'}>
      <button type="button" class="voice-play" aria-label=${(this.playing ? 'Pause ' : 'Play ') + name} @click=${press(() => this.toggle())}><span class="icon" data-icon=${this.playing ? 'pause' : 'play'} aria-hidden="true"></span></button>
      <div class="voice-wave" role="slider" tabindex="0" aria-label=${'Position in ' + name} aria-valuemin="0" aria-valuemax=${String(Math.round(this.length))} aria-valuenow=${String(Math.round(this.position))} aria-valuetext=${elapsed + ' of ' + total} @pointerdown=${(e) => this.seekPress(e)} @keydown=${(e) => this.seekKey(e)}>${this.wave.map((level, i) => html`<span class="voice-bar" data-level=${String(level)} data-done=${i < filled ? 'true' : 'false'}></span>`)}</div>
      <span class="voice-time"><span class="voice-elapsed">${elapsed}</span><span class="voice-of" aria-hidden="true">/</span><span class="voice-length">${total}</span></span>
      ${unplayed ? html`<span class="voice-unplayed" role="img" aria-label="Not played"></span>` : nothing}
      ${this.src ? html`<audio class="voice-audio" src=${this.src} preload="metadata" @play=${() => this.onPlay()} @pause=${() => this.onPause()} @ended=${() => this.onEnded()} @timeupdate=${(e) => this.onTime(e)} @loadedmetadata=${(e) => this.onLength(e)} @durationchange=${(e) => this.onLength(e)} @error=${() => this.fail()}></audio>` : nothing}
    </div>`;
  }
}

customElements.define('app-audio', AppAudio);
