# Session-bound supplemental metadata

This is a source-only addition to the embedding experiment. Production main.js is unchanged. The existing readers remain the product implementation and the differential oracle until the coordinated native adapter cutover removes them.

## Declared call

nativeMetadataRead(sessionId, kind, guidsJSON) returns JSON containing pid and rows, or one constant error code. Allowed kinds are voices, renames, sendEffects and members. It takes no SQL, path, mutation flag or arbitrary method. Only an admitted non-fixture library session supplies the database path. Calls after close begins, unknown sessions and synthetic-engine sessions are refused. The C result is copied before its allocation is freed; no V8 handle crosses threads.

Swift opens SQLite read-only, verifies main is read-only, binds GUIDs, never creates an absent file, never waits on a busy lock, and closes every statement and connection before return. The call runs synchronously on the Node worker to preserve the existing among() seam; the Swift main loop remains separate. Admission is at most 128 GUIDs, 512 UTF-8 bytes each and no NUL. Statements have a one-million SQLite VM-step budget, each SQLite value and JSON result is bounded to 65,536 bytes. JS chunks a larger page without silently discarding ids. These are experiment resource limits, not production performance acceptance. A page containing an oversized field fails rather than returning partial metadata.

A legacy message table missing an optional column answers empty for that kind. Missing/unreadable stores and malformed schemas answer errors, not empty. Swift error text never carries database paths, SQL, GUIDs or message data. Existing engine enrichment failure logging remains unchanged; this does not yet implement capability-aware client denial responses. Reader close retains no database resource.

metadata.cjs compares all four readers to the unchanged product readers using synthetic fixtures, including duplicated/unknown/injection-shaped ids, more than one batch, null/removed names, voice played timestamps and known send effects. It asserts the unchanged engine actually consumes voice/played metadata in history and live messages, send effects in history and rename event metadata in history. A missing-metadata mutation must fail the parity assertion. MetadataTests cover read-only bytes, invalid admission, legacy columns, absent-file denial, malformed schema and query-budget termination.

## Production adapter ledger

- child.js / main.js makeTransport: long-lived in-process library transport proven separately; production still uses childTransport.
- voices.js, renames.js, send-effects.js: this native read-only port and injected JS adapters; no production wiring change.
- edits.js: SQLite plus binary plist and attributed-string decoding remain to port; scan/latest and edit history must stay equivalent.
- rich-text.js: attributed-string decoding, text identity checks and runs remain to port.
- changes.js: bounded session-native latest/read/unsent/among reader and unchanged-engine differential proof; see change-contract.md for cursor semantics, replay/restart, resource refusals and remaining production cutover.
- members.js: this native read-only port and injected JS adapter; add/remove/leave actions, optional handle schemas and JS-compatible string/type handling. History and live event consumers are exercised; no production wiring change.
- backgrounds.js: row metadata plus imsg status subprocess and cache path lookup remain to port.
- contacts.js: Contacts framework/JXA reads and changes are another owner; no files changed here.
- mac.js/mac-care.js: power assertions, system settings, lock and permission preflight shell-outs remain native-host work.
- attachments.js/link-media.js: image/audio/video/thumbnail conversion and trusted cache paths remain native framework work; conversion limits, original fallback and path safety stay required.
- release/service/install/updater: separate stream; source tests do not establish signing identity, grants, installation or updater retention.

The membership extension preserves null handles when the optional handle column/table is absent; unknown item/action pairs never become events. Handle trimming matches JS String.trim including BOM and excluding NEL, non-text handles stay null, and length-aware SQLite strings retain embedded NUL characters. Synthetic differential fixtures cross the 128-id batch boundary. A reproduced pre-start stream cancellation race is repaired by checking cancellation behind the startup lock before engine entry; this does not establish prevention of writes accepted by an already-running engine.

Node 24.21.0 remains a supported tested engineering candidate, with 26.7.0 as the other measured candidate. Running either test is not a product runtime decision. All twenty canonical acceptance obligations remain open, including host-spec completeness, complete dependency removal, release/platform gates, signed identity/TCC, client denial/empty parity, witnessed setup/menu, supervised sends and soak.
