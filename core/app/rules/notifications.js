// The notices the client can raise, and the rule that decides whether each may fire. Pure: the server-held settings
// decide, and the page draws. One name per type, so a settings key and the code that raises that notice cannot drift.
import { SETTINGS_SCHEMA, settingValue } from './settings.js';

export const NOTICE_TYPES = {
  newMessage: 'notifications.newMessage',
  updateAvailable: 'notifications.updateAvailable',
  updateReady: 'notifications.updateReady',
  error: 'notifications.errors',
};

// The update states the shell may send, split by whether they raise a notice. The state names are the bridge spec's;
// these two lists are the rules' side of that contract, so a state the spec adds fails the test until it is either
// given a notice or called silent here, rather than slipping through as a null and never appearing.
export const NOTICE_UPDATE_STATES = ['available', 'ready', 'error'];
export const SILENT_UPDATE_STATES = ['checking'];

// A notice fires unless its own switch is explicitly off; a key the server has never seen keeps the schema default.
export function noticeEnabled(settings, type) {
  const key = NOTICE_TYPES[type];
  if (!key || !SETTINGS_SCHEMA.keys[key]) return false;
  return settingValue({ key, ...SETTINGS_SCHEMA.keys[key] }, settings) === true;
}

// The notice an update state raises, or null when that state raises none. The copy lives here so every platform reads
// it, and nothing about the update's transport leaks into it.
export function updateNotice(state, version) {
  const v = version ? String(version) : '';
  if (state === 'available') return { type: 'updateAvailable', title: 'Update available', body: v ? 'Version ' + v + ' is available to download.' : 'A new version is available to download.' };
  if (state === 'ready') return { type: 'updateReady', title: 'Update ready', body: 'Restart the app to install the downloaded update.' };
  if (state === 'error') return { type: 'error', title: 'Update check failed', body: 'The app could not check for updates.' };
  return null;
}
