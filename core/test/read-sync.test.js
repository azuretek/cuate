// Read state follows across devices (issue 323): what is read in this app is read on the Mac, and so on the phone,
// and what is read on the phone or the Mac clears here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyMessageToChats } from '../app/rules/chats.js';

const root = readFileSync(new URL('../app/components/app-root.js', import.meta.url), 'utf8');
const chat = (id, unread = 0) => ({ id, unread, lastMessageAt: '2026-01-01T00:00:00.000Z' });
const msg = (chatId, fromMe = false) => ({ id: 'm-' + chatId, chatId, fromMe, text: 'hi', sentAt: '2026-01-02T00:00:00.000Z', attachments: [] });

test('opening a conversation reads it on the Mac every time, not only when this page counted it unread', () => {
  assert.match(root, /readOnMac\(this, chatId\);/, 'the open asks the Mac');
  assert.doesNotMatch(root, /if \(wasUnread && this\.client\) this\.client\.markRead/, 'no longer gated on this page\'s own count');
});

test('a message that arrives in the conversation on screen is read on the Mac, and one that arrives while hidden is unread', () => {
  assert.match(root, /const seen = this\.openChatId && !pageHidden\(\) \? this\.openChatId : null;/);
  assert.match(root, /if \(!m\.fromMe && m\.chatId === seen\) readOnMac\(this, m\.chatId\);/);
  assert.equal(applyMessageToChats([chat('1')], msg('1'), { openChatId: '1' }).chats[0].unread, 0, 'on screen: read');
  assert.equal(applyMessageToChats([chat('1')], msg('1'), { openChatId: null }).chats[0].unread, 1, 'hidden: unread');
  assert.match(root, /document\.addEventListener\('visibilitychange', this\.onVisible\)/, 'coming back reads it');
});

test('a burst of arrivals is one read on the Mac', () => {
  assert.match(root, /const READ_COALESCE_MS = \d+;/);
  assert.match(root, /if \(page\.readTimers\.has\(id\)\) return;/);
});
