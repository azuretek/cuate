# Read and typing: what the engine gives us

The engine interface, not a timer or a local read mark, determines what we can say about another person (issue #72).

## Evidence

Verified against upstream revision [640f58f](https://github.com/openclaw/imsg/tree/640f58f4f80220b10082eafe4d725049fe2acb77):

- [Message JSON](https://github.com/openclaw/imsg/blob/640f58f4f80220b10082eafe4d725049fe2acb77/docs/json.md#message): `is_read` and `date_read` are inbound-only database snapshots. They are our read state, not the recipient's.
- [Send status](https://github.com/openclaw/imsg/blob/640f58f4f80220b10082eafe4d725049fe2acb77/docs/rpc.md#messagesend_status): `message.send_status` takes an outgoing GUID and returns `status_fields.date_read`. Missing rows have null status fields; delivery alone does not prove reading.
- [Bridge events](https://github.com/openclaw/imsg/blob/640f58f4f80220b10082eafe4d725049fe2acb77/docs/rpc.md#bridgeeventssubscribe): newer engines expose typing through `bridge.events.subscribe`, not only the CLI's `watch --bb-events`. This requires an already-running injected bridge and readable event log. Events have no replay cursor and are not resumable. Ordinary `watch.subscribe` still supplies no typing signal.
- [Bridge requirements](https://github.com/openclaw/imsg/blob/640f58f4f80220b10082eafe4d725049fe2acb77/docs/advanced-imcore.md): private bridge availability is not permission to install or activate injected code.

## Recipient read snapshots

When history loads, the adapter requests status for the latest outgoing message in that page, only if the engine's runtime `status.methods` advertises `message.send_status`. It makes at most one extra request per page, with a two-second ceiling. It does not scan or repeatedly poll the full history.

Only an affirmative result for that exact GUID with a valid read timestamp at or after the send time becomes `Message.readAt`. The conversation's existing delivery line shows Read with that reported ISO timestamp. Reopening the conversation refreshes the snapshot. This is not a live read event. Inbound read marks, missing rows, missing receipts, malformed dates and unsupported methods never become a recipient read claim. A failed status request leaves history usable; an unsupported-method response disables further status requests until engine restart.

Read receipts depend on the recipient sharing them. Unknown is not unread. The existing outbound mark-read route is separate and unchanged.

## Typing boundary

The configured ordinary database watch cannot report another person typing. The only source that does is an injected v2 bridge's event stream (`bridge.events.subscribe`, `started-typing`/`stopped-typing`), which the server never starts or injects, and the Messages database holds no typing state. That path is present and OFF behind `typing.incoming` in the server config, with the source cited in the code; the app draws no indicator for the other person where the engine cannot report one. Enabling it still needs a separate authorized engine/bridge decision and non-resumable stream handling, including stop, disconnect and expiry clearing. It is not an emoji or read-poll prerequisite.

Our own typing is a different thing and is real (issue 230): while you compose, the page tells the server and the server relays it to this account's other signed-in devices alone, over the same event stream, for that conversation only. It is held in memory with a short expiry, it clears when the draft empties, when the message sends or when you leave the conversation, and it never enters message history. The server that a device reaches is the account, so a relay never crosses accounts, and the event names one conversation, so it never shows for another.

## Emoji and attachment acceptance

PRs #77 and #102 supply the searchable/category emoji picker, caret/grapheme editing, attachment menu and synthetic codepoint round-trip through send, history, live events, list preview and notification. PR #125 improves the recent row placement. These paths remain unchanged. Synthetic fixtures exercise read success and refusal without sending any real message. Full platform presentation verification remains with the platform CI legs; a unit test alone is not proof of a phone's rendered composer.
