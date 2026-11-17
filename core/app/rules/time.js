// Pure: how times read in the chat list and the conversation. The current time, locale and zone are passed in.
const dayKey = (t, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

export function daysAgo(iso, { now, timeZone } = {}) {
  const a = dayKey(Date.parse(iso), timeZone);
  const b = dayKey(now, timeZone);
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

const clock = (t, locale, timeZone) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(t);

export function formatListTime(iso, { now, locale, timeZone } = {}) {
  if (!iso) return '';
  const t = Date.parse(iso);
  const d = daysAgo(iso, { now, timeZone });
  if (d <= 0) return clock(t, locale, timeZone);
  if (d === 1) return 'Yesterday';
  if (d < 7) return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone }).format(t);
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).format(t);
}

// When a message was read (issue 537), said the way the conversation says a time: the time alone today, Yesterday, the
// weekday this week, and the date before that, each with the time.
export function formatReadTime(iso, { now, locale, timeZone } = {}) {
  if (daysAgo(iso, { now, timeZone }) <= 0) return clock(Date.parse(iso), locale, timeZone);
  return formatSeparator(iso, { now, locale, timeZone });
}

export function formatSeparator(iso, { now, locale, timeZone } = {}) {
  const t = Date.parse(iso);
  const d = daysAgo(iso, { now, timeZone });
  if (d <= 0) return 'Today ' + clock(t, locale, timeZone);
  if (d === 1) return 'Yesterday ' + clock(t, locale, timeZone);
  if (d < 7) return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone }).format(t) + ' ' + clock(t, locale, timeZone);
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(t);
}
