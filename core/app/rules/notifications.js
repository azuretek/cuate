// The notices the client can raise, and the rule that decides whether each may fire. Pure: the server-held settings
// decide, and the page draws. One name per type, so a settings key and the code that raises that notice cannot drift.
import { SETTINGS_SCHEMA, settingValue } from './settings.js';
import { messageSummary } from './payload.js';

export const NOTICE_TYPES = {
  newMessage: 'notifications.newMessage',
  updateAvailable: 'notifications.updateAvailable',
  updateReady: 'notifications.updateReady',
  error: 'notifications.errors',
};

// The update states the shell may send, split by whether they raise a notice. The state names are the bridge spec's;
// these two lists are the rules' side of that contract, so a state the spec adds fails the test until it is either
// given a notice or called silent here, rather than slipping through as a null and never appearing. The download and
// stall states are drawn as the in-app banner instead of a native notice, so they are silent here on purpose, and so are
// the answers to a check someone asked for (nothing newer, or no update path), which they asked for in the app itself.
export const NOTICE_UPDATE_STATES = ['available', 'ready', 'error'];
export const SILENT_UPDATE_STATES = ['checking', 'downloading', 'stalled', 'current', 'unsupported'];

// A notice fires unless its own switch is explicitly off; a key the server has never seen keeps the schema default.
export function noticeEnabled(settings, type) {
  const key = NOTICE_TYPES[type];
  if (!key || !SETTINGS_SCHEMA.keys[key]) return false;
  return settingValue({ key, ...SETTINGS_SCHEMA.keys[key] }, settings) === true;
}

// Whether a found release is fetched without being asked again. Reads the one key the shell is told, so the page and
// the shell cannot disagree about whether automatic download is on.
export function autoDownloadEnabled(settings) {
  const key = 'updates.autoDownload';
  if (!SETTINGS_SCHEMA.keys[key]) return false;
  return settingValue({ key, ...SETTINGS_SCHEMA.keys[key] }, settings) === true;
}

// The name one update notice is remembered by, so a release is announced once however many checks find it: the check
// at start and every interval check after it report the same pending release, and a page reload hears the shell's last
// state again. A failure has no key, so every failure is still said.
export function updateNoticeKey(state, version) {
  if (state !== 'available' && state !== 'ready') return null;
  return state + ':' + (version ? String(version) : '');
}

// The notice an update state raises, or null when that state raises none. The copy lives here so every platform reads
// it, and nothing about the update's transport leaks into it. A failure may carry a scrubbed reason, so a download
// that failed or an install that was refused says so rather than failing quietly.
export function updateNotice(state, version, detail = null) {
  const v = version ? String(version) : '';
  const why = detail ? String(detail) : null;
  if (state === 'available') return { type: 'updateAvailable', title: 'Update available', body: v ? 'Version ' + v + ' is available to download.' : 'A new version is available to download.' };
  if (state === 'ready') return { type: 'updateReady', title: 'Update ready', body: 'Restart the app to install the downloaded update.' };
  if (state === 'error') return { type: 'error', title: 'Update failed', body: why || 'The update could not be checked for or downloaded.' };
  return null;
}

// The installed server's update outcomes that raise the update-error notice: a release it refused, and a version it
// rolled back from (or could not). The server reports its last outcome on info and as the server.update event, so a
// client that was disconnected by the rollback's restart hears of it when it reconnects. A healthy update is silent.
export const SERVER_UPDATE_ERRORS = ['refused', 'rolled_back', 'rollback_failed'];

// The update-error notice for a server update outcome, with the key it is remembered by so one outcome is announced
// once however many times info reports it; null for an outcome that raises none.
export function serverUpdateNotice(outcome) {
  if (!outcome || !SERVER_UPDATE_ERRORS.includes(outcome.state)) return null;
  const notice = updateNotice('error', outcome.version, outcome.detail || null);
  return { ...notice, title: 'Server update failed', key: 'server:' + outcome.state + ':' + (outcome.version || '') + ':' + (outcome.at || '') };
}

// The native notice for an incoming message: the chat's title, and the message's own text exactly as it arrived, so
// an emoji reads in the notice as it does in the conversation. A message with no text reads as the link it is, or its
// attachment, never as a payload's raw name (issue 238).
export function messageNotice(title, m) {
  const count = Array.isArray(m.attachments) ? m.attachments.length : 0;
  return { title, body: messageSummary(m) || (count > 1 ? count + ' attachments' : 'Attachment') };
}
