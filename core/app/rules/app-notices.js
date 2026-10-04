import { updateBanner, DISMISS } from './updates.js';

// One identity is one operation, not one progress tick. Dismissal reads that phase;
// progress stays silent until the operation changes phase, as in the sibling notice store.
export function putNotice(notices, notice) {
  if (!notice?.id || !notice.message) return notices;
  const prior = notices.find((n) => n.id === notice.id);
  const next = { ...notice, read: prior?.revision === notice.revision && prior.read === true };
  if (prior && JSON.stringify(prior) === JSON.stringify(next)) return notices;
  return prior ? notices.map((n) => n.id === notice.id ? next : n) : [...notices, next];
}

// The sibling's eighth rule: a transient state the reader is meant to read stays up for motion.min-visible before
// anything replaces it. Only a transient card (a check in progress) is floored; a standing condition or a progress
// tick never is. Returns how long a change to the card under `id` must still wait; zero means apply it now.
export function noticeHoldMs(notices, id, notice, shownAt, now, floorMs) {
  const prior = notices.find((n) => n.id === id && !n.read);
  if (!prior?.transient || !Number.isFinite(shownAt) || prior.revision === notice?.revision) return 0;
  return Math.max(0, floorMs - (now - shownAt));
}

export function dismissNotice(notices, id) {
  return notices.map((n) => n.id === id ? { ...n, read: true } : n);
}

// A question asked again (About's Check for updates, issue 171) deserves its answer even when the same answer was read
// and dismissed before: the dismissed card is forgotten so the next one arrives unread. An unread card is left alone.
export function forgetRead(notices, id) {
  return notices.some((n) => n.id === id && n.read) ? notices.filter((n) => n.id !== id) : notices;
}

export function appUpdateNotice(status) {
  if (!status) return null;
  const banner = updateBanner(status.state, status);
  if (!banner) return null;
  return {
    id: 'app-update', revision: [status.state, status.version || '', status.state === 'error' ? status.detail || '' : ''].join(':'),
    ...banner, action: banner.action?.command === DISMISS ? null : banner.action,
    tone: status.state === 'error' ? 'error' : status.state === 'stalled' ? 'warn' : status.state === 'ready' || status.state === 'current' ? 'ok' : 'info',
    transient: status.state === 'checking',
    percent: Number.isFinite(banner.percent) ? Math.max(0, Math.min(1, banner.percent)) : null,
  };
}

// The state that outlives a render (issue 191). A notice nobody has acknowledged carries no revision under its id;
// closing it remembers its revision on this device, and marking it read remembers its revision on the server so every
// device agrees. Both hide the card until its operation changes phase, because a new outcome is news that may announce
// itself. The two keys are the store names: the server setting and the shell's device store.
export const NOTICE_READ_KEY = 'notice.read'; // the server setting: { [id]: revision }
export const NOTICE_CLOSED_KEY = 'notice.closed'; // this device's store, as a JSON object: { [id]: revision }

// An id -> revision map from whatever a store handed back: the server's setting (an object), the device store (a JSON
// string), or nothing. Anything else reads as empty, so a value a store mangled never throws in a render. Only string
// revisions survive, and an empty key is dropped, so a map a bug left behind cannot hide a notice it never named.
export function noticeState(raw) {
  let value = raw;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return {}; } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [id, revision] of Object.entries(value)) if (id && typeof revision === 'string') out[id] = revision;
  return out;
}

// One id's remembered revision, or null.
export function noticeStateOf(state, id) {
  return state && Object.hasOwn(state, id) ? state[id] : null;
}

// A state map with one id's revision remembered. A revision that is not a string changes nothing, so a caller with no
// revision to hand (a notice already gone) cannot write a value that would hide the next one.
export function withNoticeState(state, id, revision) {
  const out = noticeState(state);
  if (id && typeof revision === 'string') out[id] = revision;
  return out;
}

// Whether a notice is already quiet: the revision under its id was closed here or read on the server.
export function noticeQuiet(notice, read = {}, closed = {}) {
  if (!notice) return false;
  return noticeStateOf(read, notice.id) === notice.revision || noticeStateOf(closed, notice.id) === notice.revision;
}

// The notices with every remembered revision marked read, so the stack draws none of them. This only ever adds read:
// a notice whose revision is in neither store is left exactly as putNotice made it, and a new revision is unread.
export function quietNotices(notices, read = {}, closed = {}) {
  return notices.map((n) => (noticeQuiet(n, read, closed) ? { ...n, read: true } : n));
}
