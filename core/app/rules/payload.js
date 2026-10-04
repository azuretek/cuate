// Pure: how a message that arrives as a plugin payload is read. The system keeps the inside of such a message (a link
// preview, or any app's message) as a file whose name ends ".pluginPayloadAttachment", beside the real attachments. It
// is never a file a person sent, so its raw name is never drawn: what it holds becomes a link card, or media we show
// like any other attachment, or nothing at all, and either way it is drawn quietly.

// The suffix the system gives a file that is a message's own payload rather than a file it carried.
const PAYLOAD_SUFFIX = /\.pluginpayloadattachment$/i;

// Whether an attachment name is a message's own payload rather than a file it carried.
export function isPayloadName(name) {
  return PAYLOAD_SUFFIX.test(String(name || ''));
}

// The first http(s) URL in a line of text, or ''. A trailing mark that is not part of the URL is dropped.
export function firstUrl(text) {
  const m = /https?:\/\/[^\s<>"'`]+/i.exec(String(text || ''));
  if (!m) return '';
  return m[0].replace(/[.,;:!?)\]]+$/, '');
}

// The site a URL names, readably: its host without a leading www, read by hand rather than with the URL API, which
// the embedded engines a shell runs do not all carry. A URL that cannot be read gives ''.
export function linkSite(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
  if (!m) return '';
  const host = m[1].replace(/^.*@/, '').replace(/:[0-9]+$/, '').toLowerCase();
  return host.replace(/^www\./, '');
}

// Whether a payload is media we can show in place (a picture or a video), from the type its own bytes gave it.
export function payloadMedia(mime) {
  return /^(?:image|video)\//i.test(String(mime || ''));
}

// What a payload carries that is not media and not a link, as a count: these are drawn quietly, never by name.
export function quietCount(payloads) {
  return (Array.isArray(payloads) ? payloads : []).length;
}

// The readable one line a notice or a chat-list preview shows for a message: its text, else the link it is, else its
// real attachments, else a quiet word when only a payload is left. A payload's own name is never one of them.
export function messageSummary(m) {
  const text = String((m && m.text) || '').replace(/\s+/g, ' ').trim();
  if (text) return text;
  const link = m && m.link;
  if (link) return String(link.title || link.site || link.url || '').trim();
  const list = Array.isArray(m && m.attachments) ? m.attachments : null;
  const count = list ? list.length : (typeof (m && m.attachments) === 'number' ? m.attachments : 0);
  if (list) {
    const names = list.map((a) => String((a && a.name) || '').trim()).filter(Boolean);
    if (names.length === 1) return names[0];
    if (count > 1) return count + ' attachments';
  } else {
    if (count === 1) return '1 attachment';
    if (count > 1) return count + ' attachments';
  }
  if (m && Number(m.payloads) > 0) return 'Attachment';
  return '';
}
