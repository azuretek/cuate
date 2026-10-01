# Read and typing: what the engine gives us

This page states what the engine reports about the other person reading and typing, from the engine's own interface and before any surface is wired to it (issue 72). It is the finding, not the wish. Where the engine is silent, the app stays silent too.

The engine is the server's interface to the Mac (`imsg`, the open-source tool the server supervises). Its contract is its own documentation and its JSON-RPC method list.

## Typing

- The engine can show and hide **our** typing bubble on the recipient's device: `imsg typing --to <handle>` (and `--stop true`), and only through the injected helper dylib.
- It reports the **other person** typing only through `imsg watch --bb-events`, which emits `started-typing` and `stopped-typing` written by that injected helper.
- That stream is best-effort by the engine's own description: it has **no replay cursor and is not resumable**, and it starts at the event log's current end. The ordinary `imsg watch` the server runs emits messages, tapbacks and polls only, and carries no typing event at all.
- The injection needs **SIP disabled, library validation off and no private-entitlement gate**. The engine's own guide calls these features "opt-in, SIP-disabled, and increasingly limited on macOS 26", and says typing indicators "frequently fail with an entitlement error" there.

So over the surface the server uses, the ordinary watch and the database, the engine does **not** report the other person typing. An indicator drawn from nothing would be a placeholder that means nothing, so the app draws none.

## Read

- **Marking a chat read** is established and outbound: `imsg read --to <handle>` clears the unread counter, and the server already marks a conversation read when a client opens it.
- In the message JSON, `is_read` and `date_read` are **inbound only**. The engine omits them when the message is ours, and calls the value "a database snapshot" taken when the row is emitted, not a second event when it changes. That is **our** read state of their message, which is the unread state the app already holds.
- The other side reading **our** message is reachable only as a per-message poll: `message.send_status` returns `status_fields.date_read` for one outgoing message. There is no read event on the live stream, and the value depends on the recipient having read receipts switched on.

So the live stream carries no read receipt either. The two honest read surfaces are the unread state we already hold, and, if we choose to poll, our own outgoing message's `date_read` shown as the recipient's read time and only when it is present. Nothing invents a "seen".

## What the surfaces may say

| Surface | The engine gives us | The app draws |
| --- | --- | --- |
| Our typing bubble | show and hide, private bridge only | nothing yet |
| Their typing | private bridge only, not resumable | nothing |
| Unread of their messages | `is_read` / `date_read` on inbound rows | the unread dot and state we already have |
| Their read of ours | `message.send_status` `date_read`, a poll | nothing yet, and only ever labelled as read, with the time it reports |
