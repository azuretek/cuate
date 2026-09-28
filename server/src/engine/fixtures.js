// Synthetic data only. Handles are in the fictional 555-555-01xx range or at example.com, and every text is written
// here; core/test/rules.test.js asserts both, so no real conversation can slip into a fixture.
export const SYNTHETIC_HANDLE = /^(?:\+1555555\d{4}|[a-z]+@example\.com)$/;

const NAMES = { '+15555550100': 'Avery Quinn', 'jordan@example.com': 'Jordan Lee', 'priya@example.com': 'Priya Shah', '+15555550177': 'Sam Rivera' };

const CHATS = [
  { id: 1, name: 'Avery Quinn', display_name: '', contact_name: 'Avery Quinn', identifier: '+15555550100', guid: 'iMessage;-;+15555550100', service: 'iMessage', is_group: false, participants: ['+15555550100'], unread_count: 1 },
  { id: 2, name: 'Weekend plans', display_name: 'Weekend plans', contact_name: '', identifier: 'chat500000001', guid: 'iMessage;+;chat500000001', service: 'iMessage', is_group: true, participants: ['jordan@example.com', '+15555550177', 'priya@example.com'], unread_count: 0 },
  { id: 3, name: '+15555550142', display_name: '', contact_name: '', identifier: '+15555550142', guid: 'SMS;-;+15555550142', service: 'SMS', is_group: false, participants: ['+15555550142'], unread_count: 0 },
];

// [chat, minutes before the base time, from me, sender, text, has the photo]
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
];

const REACTIONS = { 12: [{ reaction_type: 'love', sender: '+15555550100', is_from_me: false }] };

export function buildFixtures({ base, imagePath, imageBytes }) {
  const chats = CHATS.map((c) => ({ ...c, participants: [...c.participants] }));
  const messages = SCRIPT.map(([chat, minutes, fromMe, sender, text, photo], i) => {
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
      attachments: photo ? [{ filename: 'sunset.png', transfer_name: 'sunset.png', uti: 'public.png', mime_type: 'image/png', total_bytes: imageBytes, is_sticker: false, missing: false, original_path: imagePath }] : [],
    };
    if (!fromMe) m.is_read = i !== SCRIPT.length - 1;
    if (REACTIONS[id]) m.reactions = REACTIONS[id];
    return m;
  });
  return { chats, messages };
}
