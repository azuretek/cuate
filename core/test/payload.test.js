// A message's own plugin payload is read as the link it is, never as its raw filename (issue 238).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapMessage } from '../app/rules/engine-imsg.js';
import { chatPreview } from '../app/rules/chats.js';
import { messageNotice } from '../app/rules/notifications.js';
import { isPayloadName, firstUrl, linkSite, messageSummary } from '../app/rules/payload.js';

const id = (a) => 'att' + String(a.transfer_name || a.filename || 'x').replace(/[^A-Za-z0-9]/g, '').slice(0, 8);
const msg = (over = {}) => mapMessage({
  id: 7, guid: 'G-7', chat_id: 1, is_from_me: false, sender: '+15555550100', sender_name: 'Avery Quinn',
  text: '', created_at: '2026-01-15T10:00:00Z', is_read: true, attachments: [], reactions: [], ...over,
}, { attachmentId: id });

const named = (o) => ({ transfer_name: o.name, filename: o.name, mime_type: o.mime || '', total_bytes: o.bytes || 0, is_sticker: false, missing: o.missing || false, original_path: o.path === null ? null : 'Messages/Attachments/' + o.name });
const linkPayload = (mime = '', over = {}) => named({ name: 'D15E301E-EDE6-473D-9DF7-00BD12F88274.pluginPayloadAttachment', mime, bytes: 52554, ...over });

test('a payload is recognised by its name', () => {
  assert.equal(isPayloadName('X.pluginPayloadAttachment'), true);
  assert.equal(isPayloadName('X.PLUGINPAYLOADATTACHMENT'), true);
  assert.equal(isPayloadName('sunset.png'), false);
});

test('a URL reads readably and a stray mark is dropped', () => {
  assert.equal(firstUrl('look https://www.instagram.com/reel/x/?a=1, ok'), 'https://www.instagram.com/reel/x/?a=1');
  assert.equal(linkSite('https://www.instagram.com/reel/x/'), 'instagram.com');
  assert.equal(linkSite('not a url'), '');
});

test('a link payload becomes a link card: the site and the URL, never a filename', () => {
  const m = msg({ text: 'https://www.instagram.com/reel/Dda347IpKrV/', attachments: [linkPayload('image/jpeg')] });
  assert.deepEqual(m.link, { url: 'https://www.instagram.com/reel/Dda347IpKrV/', site: 'instagram.com', title: null, image: { id: id({ transfer_name: 'D15E301E-EDE6-473D-9DF7-00BD12F88274.pluginPayloadAttachment' }), name: 'Link preview', mime: 'image/jpeg', bytes: 52554, sticker: false, missing: false } });
  assert.deepEqual(m.attachments, [], 'the payload is not a file');
  assert.equal(m.payloads, 0);
  assert.ok(!JSON.stringify(m).includes('.pluginPayloadAttachment'), 'no raw payload name anywhere in the model');
});

test('a payload with a title and a picture carries both into the card', () => {
  const m = msg({ payload_url: 'https://example.com/a/thing', payload_title: 'A thing worth reading', attachments: [linkPayload('image/jpeg')] });
  assert.equal(m.link.site, 'example.com');
  assert.equal(m.link.title, 'A thing worth reading');
  assert.ok(m.link.image && m.link.image.mime === 'image/jpeg');
});

test('a payload that cannot be parsed is drawn quietly, never as a filename', () => {
  const m = msg({ attachments: [linkPayload('application/octet-stream')] });
  assert.equal(m.link, null);
  assert.deepEqual(m.attachments, []);
  assert.equal(m.payloads, 1, 'the unreadable payload is a quiet count, not a file');
  assert.ok(!JSON.stringify(m).includes('.pluginPayloadAttachment'), 'no filename reaches the model');
  assert.equal(chatPreview({ lastMessage: { text: m.text, fromMe: m.fromMe, attachments: m.attachments.length, link: m.link, payloads: m.payloads } }), 'Attachment');
});

test('a payload that carries real media is an attachment like any other', () => {
  const m = msg({ attachments: [linkPayload('image/jpeg')] });
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].name, 'Photo', 'an honest name, never the raw one');
  assert.equal(m.attachments[0].mime, 'image/jpeg');
  assert.equal(m.link, null);
  assert.ok(!JSON.stringify(m).includes('.pluginPayloadAttachment'));
});

test('an ordinary attachment is untouched and no link is invented for plain text', () => {
  const m = msg({ text: 'https://example.com/just-text', attachments: [named({ name: 'sunset.png', mime: 'image/png' })] });
  assert.equal(m.link, null, 'a link card needs a payload, not just a URL in the text');
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].name, 'sunset.png');
  assert.equal(m.attachments[0].mime, 'image/png');
  assert.equal(m.payloads, 0);
});

test('the chat-list preview and the notice read the link, never a payload name', () => {
  const link = { url: 'https://www.instagram.com/reel/x/', site: 'instagram.com', title: null, image: null };
  assert.equal(chatPreview({ lastMessage: { text: '', fromMe: false, attachments: 0, link, payloads: 0 } }), 'instagram.com');
  assert.equal(chatPreview({ lastMessage: { text: '', fromMe: true, attachments: 0, link: null, payloads: 1 } }), 'You: Attachment');
  assert.deepEqual(messageNotice('Avery Quinn', { text: '', attachments: [], link, payloads: 0 }), { title: 'Avery Quinn', body: 'instagram.com' });
  assert.equal(messageSummary({ text: 'https://example.com/x', attachments: [] }), 'https://example.com/x');
});
