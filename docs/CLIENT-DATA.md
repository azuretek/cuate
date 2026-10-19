# Client data on the device

Every value a client keeps on the device is listed here, with where it lives and whether the server is the owner. A
value the server owns is read on connect and written back when it changes, so the same person sees it everywhere; a
value the device owns is deliberately local, with the reason it is not shared. The list is held to the code by
`core/test/client-data.test.js`: a storage key the client uses that is not named here, or a row with no side and no
reason, fails the test.

| Item | Where it lives | Status | Why |
|---|---|---|---|
| Emoji favourites (`emoji.favourites`) | Shell storage (Keychain, Keystore or the desktop's safeStorage), or `localStorage` in a plain browser | Server-synced, with a device cache | The server holds one list keyed to the person, so every device draws the same row (issue 494). The cache makes the row readable before the first round trip and while offline, and a change made offline is queued and sent when the connection returns. |
| Previously used emoji (`emoji.frequent`) | Shell storage | Device local, retired | The list the client kept before the server held it (issue 302). It is read once at upgrade, turned into the person's first favourites, and deleted; nothing writes it again. |
| Emoji skin tones (`emoji.tones`) | Shell storage | Device local | The choice belongs to the emoji this device's font can draw, and a device that cannot draw a tone never offers it (issue 392). Sharing it would name a tone another device may not have. |
| Server address (`server.url`) | Shell storage | Device local | Each install reaches the server by its own address, which is the LAN address on one device and the tailnet name on another. |
| Device token (`server.token`) | Shell storage, encrypted at rest | Device local | A credential minted for one device and revoked on its own, so signing one device out never signs the others out. It is never shared between devices. |
| Message store (`message-store`) | IndexedDB, in every shell | Server-synced cache | The conversations, messages, pictures and change cursor the server gave this device (issue 441), so the list and an open conversation paint before the server answers and while it is unreachable. Cleared on sign out and when the address names another server; it is never a source of truth. |
| iOS diagnostics | `Application Support/Diagnostics` | Device local | MetricKit crash and hang payloads, written by the shell and kept on the device; nothing is sent anywhere. |
| Android diagnostics | `files/diagnostics` | Device local | A record of how the last run ended, kept on the device; nothing is sent anywhere. |
| Android update download | `cache/updates` | Device local | A downloaded APK waiting to install, replaced or discarded after the install; it is regenerable and carries nothing the server does not already have. |
| Android file handoffs | `cache/saves`, `cache/open` | Device local | Copies made only so another app can save or open one attachment picked on this device; they are cleared when the app starts again. |

Not persisted, so not in the table: the open conversation, the composer's draft, the chat list's filters and sort, scroll
positions, and which panel is open. Each lives for the page in front of the person and is rebuilt from the server, or
reset, on the next launch.
