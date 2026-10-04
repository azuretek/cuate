// Synthetic data only. Handles are in the fictional 555-555-01xx range or at example.com, and every text is written
// here; core/test/rules.test.js asserts both, so no real conversation can slip into a fixture.
export const SYNTHETIC_HANDLE = /^(?:\+1555555\d{4}|[a-z]+@example\.com)$/;

const NAMES = { '+15555550100': 'Avery Quinn', 'jordan@example.com': 'Jordan Lee', 'priya@example.com': 'Priya Shah', '+15555550177': 'Sam Rivera' };

const CHATS = [
  { id: 1, name: 'Avery Quinn', display_name: '', contact_name: 'Avery Quinn', identifier: '+15555550100', guid: 'iMessage;-;+15555550100', service: 'iMessage', is_group: false, participants: ['+15555550100'], unread_count: 1 },
  { id: 2, name: 'Weekend plans', display_name: 'Weekend plans', contact_name: '', identifier: 'chat500000001', guid: 'iMessage;+;chat500000001', service: 'iMessage', is_group: true, participants: ['jordan@example.com', '+15555550177', 'priya@example.com'], unread_count: 0 },
  { id: 3, name: '+15555550142', display_name: '', contact_name: '', identifier: '+15555550142', guid: 'SMS;-;+15555550142', service: 'SMS', is_group: false, participants: ['+15555550142'], unread_count: 0 },
];

// [chat, minutes before the base time, from me, sender, text, has the photo (true) or the document ('doc'), the guid
// of the message it replies to in a thread]. Messages and its rows are ordered by guid; the thread replies and the
// document are appended so every earlier guid stays.
export const SCRIPT = [
  [3, 4000, false, '+15555550142', 'Your table for two is confirmed for Friday at 7.'],
  [3, 3990, true, null, 'Thank you'],
  [2, 1500, false, 'jordan@example.com', 'Who is in for the lake on Saturday?'],
  [2, 1498, false, 'priya@example.com', 'Me! I can bring the cooler.'],
  [2, 1490, true, null, 'Count me in. I will drive.'],
  [2, 1488, false, '+15555550177', 'I will bring snacks and the frisbee.'],
  [2, 1400, false, 'jordan@example.com', 'Leaving at 9, meet at the corner.'],
  [1, 300, false, '+15555550100', 'Are we still on for coffee tomorrow?'],
  [1, 298, true, null, 'Yes! 10 at the usual place?'],
  [1, 297, false, '+15555550100', 'Perfect.'],
  [1, 60, false, '+15555550100', 'Look at this sunset from the walk home.', true],
  [1, 58, true, null, 'Wow, that is beautiful.'],
  [1, 5, false, '+15555550100', 'See you soon'],
  // A thread (issue 195): Avery used Reply on your "Yes! 10 at the usual place?" a while later, and you answered in it.
  [1, 120, false, '+15555550100', 'Could we make it 10:30 instead?', false, 'FAKE-0009'],
  [1, 118, true, null, '10:30 works.', false, 'FAKE-0009'],
  // A second thread (issue 214), interleaved with the first so the two lines a run end draws sit on separate lanes:
  // Avery asked about the campsite, you answered, and Avery replied, between the first thread's own messages.
  [1, 260, false, '+15555550100', 'Did you book the campsite for the weekend?', false],
  [1, 130, true, null, 'Booked it, site 12 by the water.', false, 'FAKE-0016'],
  [1, 125, false, '+15555550100', 'Perfect, see you there.', false, 'FAKE-0016'],
  // A document (issue 219) on a message of its own, in no thread, so a press saves it rather than opening anything.
  [1, 90, false, '+15555550100', 'Here is the booking confirmation.', 'doc'],
];

// A message's own plugin payload (issue 238): the system keeps what a link preview or an app's message carried as a
// file named "<GUID>.pluginPayloadAttachment" beside the real attachments, and its bytes are the only word for what
// it is. Each case names the kind, so the fake engine writes a file of that kind: a link preview with a title and a
// still, a link whose payload temp file is already gone, a payload whose bytes are nothing the server reads, and a
// payload that is media with no link at all. The last row carries no payload, so an ordinary link in the text stays
// ordinary. Synthetic data only, like every text above.
// [chat, minutes before the base time, sender, text, payload kind, the title the payload carried]
export const PAYLOADS = [
  [1, 4, '+15555550100', 'https://www.example.com/posts/a-quiet-lake', 'image', 'A quiet lake at golden hour'],
  [1, 3, '+15555550100', 'https://reels.example.com/watch/8f3c1a', 'missing', ''],
  [1, 2, '+15555550100', '', 'opaque', ''],
  [1, 1, '+15555550100', '', 'image', ''],
  [1, 0, '+15555550100', 'https://www.example.com/plain-link', '', ''],
];

// The GUIDs the payload cases carry, in the order above, for a capture to focus one by.
export const PAYLOAD_GUIDS = PAYLOADS.map((_, i) => 'FAKE-' + String(SCRIPT.length + i + 1).padStart(4, '0'));

// The message Avery has not read yet: the newest in the first conversation.
const UNREAD = 'FAKE-0013';

// A reaction as imsg names it: a standard tapback by its kind with its glyph, and any other emoji (Messages' type 2006)
// as "custom" with the emoji itself, which is the shape both its inline reactions and its live rows carry (issue 188).
const TAPBACK_GLYPHS = { love: '\u2764\ufe0f', like: '\u{1F44D}', dislike: '\u{1F44E}', laugh: '\u{1F602}', emphasis: '\u203c\ufe0f', question: '\u2753' };
export function imsgReaction(kindOrEmoji) {
  return TAPBACK_GLYPHS[kindOrEmoji] ? { type: kindOrEmoji, emoji: TAPBACK_GLYPHS[kindOrEmoji] } : { type: 'custom', emoji: kindOrEmoji };
}

const REACTIONS = {
  9: [{ ...imsgReaction('\u{1F64C}'), sender: '+15555550100', is_from_me: false }],
  12: [{ ...imsgReaction('love'), sender: '+15555550100', is_from_me: false }],
};

export function buildFixtures({ base, imagePath, imageBytes, docPath, docBytes, blobPath, blobBytes }) {
  const chats = CHATS.map((c) => ({ ...c, participants: [...c.participants] }));
  // The fixture's attachments, synthetic only: a photo is a small PNG, and 'doc' is the booking PDF a press saves
  // rather than opens (issue 219).
  const attachmentFor = (kind) => {
    if (kind === 'doc') return [{ filename: 'booking.pdf', transfer_name: 'booking.pdf', uti: 'com.adobe.pdf', mime_type: 'application/pdf', total_bytes: docBytes, is_sticker: false, missing: false, original_path: docPath }];
    if (kind) return [{ filename: 'sunset.png', transfer_name: 'sunset.png', uti: 'public.png', mime_type: 'image/png', total_bytes: imageBytes, is_sticker: false, missing: false, original_path: imagePath }];
    return [];
  };
  // A payload the message carried, as the system records it: the name says it is a payload (never a file a person
  // sent), the type is empty, and original_path points at the file whose bytes are read to learn what it is.
  const payloadFor = (kind, id) => {
    if (!kind) return [];
    const tail = String(id).padStart(2, '0');
    const name = 'C0FFEE' + tail + '-0000-4000-8000-000000000000.pluginPayloadAttachment';
    const common = { filename: name, transfer_name: name, uti: 'dyn.ah62d4rv4ge81e5pe', mime_type: '', is_sticker: false };
    if (kind === 'missing') return [{ ...common, total_bytes: 0, missing: true, original_path: '' }];
    if (kind === 'opaque') return [{ ...common, total_bytes: blobBytes, missing: false, original_path: blobPath }];
    return [{ ...common, total_bytes: imageBytes, missing: false, original_path: imagePath }];
  };
  const messages = SCRIPT.map(([chat, minutes, fromMe, sender, text, photo, threadOf], i) => {
    const id = i + 1;
    const m = {
      id,
      guid: 'FAKE-' + String(id).padStart(4, '0'),
      chat_id: chat,
      is_from_me: fromMe,
      sender: fromMe ? '' : sender,
      sender_name: fromMe ? '' : NAMES[sender] || '',
      text,
      created_at: new Date(base - minutes * 60000).toISOString(),
      attachments: attachmentFor(photo),
    };
    if (!fromMe) m.is_read = m.guid !== UNREAD;
    if (REACTIONS[id]) m.reactions = REACTIONS[id];
    if (threadOf) {
      m.thread_originator_guid = threadOf;
      m.thread_originator_part = '0:0:27';
    }
    return m;
  });
  // The payload cases ride at the end of the first conversation, newest of all, so a capture of it meets the link
  // cards and the quiet rows first.
  for (const [chat, minutes, sender, text, kind, title] of PAYLOADS) {
    const id = messages.length + 1;
    const m = {
      id,
      guid: 'FAKE-' + String(id).padStart(4, '0'),
      chat_id: chat,
      is_from_me: false,
      sender,
      sender_name: NAMES[sender] || '',
      text,
      created_at: new Date(base - minutes * 60000).toISOString(),
      attachments: payloadFor(kind, id),
      is_read: true,
    };
    if (title) m.payload_title = title;
    messages.push(m);
  }
  // As Messages records it, an ordinary row's reply_to_guid names the chat's message before it, and imsg resolves that
  // message's sender and text alongside; none of it means a thread, which only thread_originator_guid does (issue 195).
  const inOrder = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const m of inOrder) {
    const prev = inOrder.filter((x) => x.chat_id === m.chat_id && x.created_at < m.created_at).pop();
    if (!prev) continue;
    m.reply_to_guid = prev.guid;
    m.reply_to_sender = prev.sender;
    m.reply_to_text = prev.text;
  }
  return { chats, messages };
}
