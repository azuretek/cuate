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

export function dismissNotice(notices, id) {
  return notices.map((n) => n.id === id ? { ...n, read: true } : n);
}

export function appUpdateNotice(status) {
  if (!status) return null;
  const banner = updateBanner(status.state, status);
  if (!banner) return null;
  return {
    id: 'app-update', revision: [status.state, status.version || '', status.state === 'error' ? status.detail || '' : ''].join(':'),
    ...banner, action: banner.action?.command === DISMISS ? null : banner.action,
    tone: status.state === 'error' ? 'error' : status.state === 'stalled' ? 'warn' : status.state === 'ready' || status.state === 'current' ? 'ok' : 'info',
    percent: Number.isFinite(banner.percent) ? Math.max(0, Math.min(1, banner.percent)) : null,
  };
}
