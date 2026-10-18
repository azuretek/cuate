// Pure: audio in a conversation, played where it was sent (issue 432).
//
// A recording, a song or a voice message is drawn in its message as a player of its own, the way a picture is drawn as
// itself: a play and pause control, a waveform that fills as it plays and takes a press or a key to move through it,
// how far in it is and how long it runs, and, for one someone else sent, whether it has been played. Nothing here
// fetches, decodes or plays anything; the player (core/app/components/app-audio.js) does that and asks these rules
// what to draw.
import { isFileAttachment, extensionOf } from './documents.js';

// The largest recording drawn as a player. Past it the file would sit in memory whole, so it is a file card that opens
// in the device's own apps instead.
export const AUDIO_INLINE_MAX_BYTES = 100 * 1024 * 1024;
// The largest recording whose waveform is read from its samples. Decoding holds every sample at once, so a longer file
// draws an even waveform instead; it still plays, fills and moves the same way.
export const WAVE_DECODE_MAX_BYTES = 10 * 1024 * 1024;

// Audio every web view the app runs in plays: MP3, AAC and MPEG-4 audio, WAV, Ogg, Opus, WebM and FLAC.
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'oga', 'ogg', 'opus', 'flac']);
const AUDIO_TYPES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/x-aac', 'audio/wav', 'audio/x-wav',
  'audio/wave', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/flac', 'audio/x-flac',
]);
// A voice message as the Mac records it (issue 435): a Core Audio file, Opus inside on current iPhones and AMR or AAC
// on older ones, or a bare AMR recording. Chromium has no demuxer for either, so these play from the server's MPEG-4
// copy unless the web view says it plays the original for certain.
const VOICE_EXTENSIONS = new Set(['caf', 'amr', '3gp', '3ga']);
const VOICE_TYPES = new Set(['audio/x-caf', 'audio/caf', 'audio/amr', 'audio/3gpp', 'audio/3gpp2']);

const bareType = (mime) => String(mime || '').split(';')[0].trim().toLowerCase();
const fits = (a, max) => !(Number.isFinite(Number(a.bytes)) && Number(a.bytes) > max);

// Whether an attachment is a recording the app plays in its message: a real file, on the Mac and fully sent, of a kind
// every web view plays, and not too large to hold. The type it carries decides first and its extension second, since
// the Mac often records a file as application/octet-stream under its real name.
export function playsInPlace(a) {
  if (!isFileAttachment(a)) return false;
  const type = bareType(a.mime);
  const generic = !type || type === 'application/octet-stream';
  const ext = extensionOf(a.name);
  const audio = AUDIO_TYPES.has(type) || VOICE_TYPES.has(type) || (generic && (AUDIO_EXTENSIONS.has(ext) || VOICE_EXTENSIONS.has(ext)));
  return audio && fits(a, AUDIO_INLINE_MAX_BYTES);
}

// The format to ask the server for: 'm4a', its MPEG-4 copy, for a voice message the web view does not say it plays for
// certain, or null for the original. canPlayType is the web view's own answer ('probably', 'maybe' or ''); 'maybe' is
// not enough, since a voice message that does not play is worse than a copy that does.
export function copyFormat(a, canPlayType) {
  const type = bareType(a && a.mime);
  const generic = !type || type === 'application/octet-stream';
  const voice = VOICE_TYPES.has(type) || (generic && VOICE_EXTENSIONS.has(extensionOf(a && a.name)));
  if (!voice) return null;
  const asked = generic ? 'audio/x-caf' : type;
  let answer;
  try { answer = typeof canPlayType === 'function' ? String(canPlayType(asked) || '') : ''; } catch { answer = ''; }
  return answer === 'probably' ? null : 'm4a';
}

// A time as a person reads it on a player: minutes and seconds, with hours only past the hour. A time not known yet
// (no metadata, or a stream with no end) reads as the start.
export function clock(seconds) {
  const s = Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? Math.floor(Number(seconds)) : 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

// How long a recording runs, to the nearest second. Web views disagree on a file's last fraction of a second (WebKit
// reads the four second fixture as 3.95, Chromium as 4.0), and cutting it off made one recording say 0:03 on a phone and
// 0:04 on a desktop; the elapsed clock still counts whole seconds as they pass.
export function lengthClock(seconds) {
  const s = Number(seconds);
  return clock(Number.isFinite(s) && s > 0 ? Math.round(s) : 0);
}

// How far through it is, from 0 to 1. A duration not known yet is the start.
export function progressOf(current, duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return Math.min(1, Math.max(0, (Number(current) || 0) / d));
}

// The waveform is a row of bars, each drawn at one of a few heights the stylesheet holds (a level from 1 to
// WAVE_LEVELS), so no bar needs a style of its own.
export const WAVE_BARS = 28;
export const WAVE_LEVELS = 8;

// An even waveform, drawn before the samples are read, or for a recording whose samples cannot be read.
export function flatWave(bars = WAVE_BARS) {
  return Array.from({ length: bars }, () => 2);
}

// The waveform of a recording from its samples: one bar per equal slice of the recording, each the loudest sample in
// its slice across every channel, scaled so the loudest bar is full height, and never below the lowest level so a
// quiet stretch still reads as part of the line. channels is a list of sample arrays (-1 to 1), one per channel.
export function wavePeaks(channels, bars = WAVE_BARS) {
  const list = (channels || []).filter((c) => c && c.length);
  const length = list.length ? Math.min(...list.map((c) => c.length)) : 0;
  if (!length) return flatWave(bars);
  const peaks = [];
  for (let b = 0; b < bars; b += 1) {
    const from = Math.floor((b * length) / bars);
    const to = Math.max(from + 1, Math.floor(((b + 1) * length) / bars));
    let peak = 0;
    for (const c of list) for (let i = from; i < to && i < length; i += 1) peak = Math.max(peak, Math.abs(c[i]) || 0);
    peaks.push(peak);
  }
  const loudest = Math.max(...peaks);
  if (!(loudest > 0)) return flatWave(bars);
  return peaks.map((p) => Math.max(1, Math.min(WAVE_LEVELS, Math.ceil((p / loudest) * WAVE_LEVELS))));
}

// How many bars are filled at a point in the recording: a bar is filled once playback has reached its middle.
export function barsDone(progress, bars = WAVE_BARS) {
  const p = Math.min(1, Math.max(0, Number(progress) || 0));
  return Math.min(bars, Math.floor(p * bars + 0.5));
}

// Where a press on the waveform moves to, as a time: its place across the waveform's width. A recording whose length
// is not known yet moves nowhere.
export function seekAt(x, left, width, duration) {
  const d = Number(duration);
  const w = Number(width);
  if (!Number.isFinite(d) || d <= 0 || !(w > 0)) return null;
  const f = Math.min(1, Math.max(0, (Number(x) - Number(left)) / w));
  return f * d;
}

// Where a key moves to on the waveform, which is a slider: the arrows step five seconds, Home and End go to either end.
// Any other key moves nothing and answers null.
export const SEEK_STEP_SECONDS = 5;
export function seekByKey(key, current, duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return null;
  const now = Number(current) || 0;
  const to = { ArrowRight: now + SEEK_STEP_SECONDS, ArrowUp: now + SEEK_STEP_SECONDS, ArrowLeft: now - SEEK_STEP_SECONDS, ArrowDown: now - SEEK_STEP_SECONDS, Home: 0, End: d }[key];
  return to === undefined ? null : Math.min(d, Math.max(0, to));
}

// Which recordings have been played on this device, kept by attachment id in the shell's storage, newest last and
// bounded so the list never grows without end.
export const PLAYED_KEY = 'audio.played';
export const PLAYED_MAX = 500;
export function encodePlayed(ids) {
  return JSON.stringify([...new Set((ids || []).map(String))].slice(-PLAYED_MAX));
}
export function decodePlayed(text) {
  try {
    const list = JSON.parse(String(text || ''));
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string' && id) : [];
  } catch {
    return [];
  }
}

// Whether a recording is drawn as not played yet: one someone else sent that has not been played. What we sent is
// never marked, and a recording the Mac records as played (a.played) or that was played on this device is played.
export function isUnplayed(a, { mine = false, played = null } = {}) {
  if (!a || mine || a.played) return false;
  return !(played && played.has(String(a.id)));
}
