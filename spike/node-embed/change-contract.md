# Source-only read and unsent change cursors

Production main.js, engine/changes.js and the API are unchanged. The existing reader is the differential oracle. This port is injected only into the embedding experiment through the existing session-authority seam; no runtime is selected and none of the twenty canonical obligations is closed.

## Authority and resources

nativeMetadataRead(sessionId, 'changes', requestJSON) accepts only latest, unsent, read and among actions. latest carries only action; unsent/read carry action, cursor and limit; among carries action and guids. There is no caller path, SQL or platform mutation method. The admitted non-fixture library session owns the database authority. Closing, closed, unknown and fixture sessions refuse synchronously through the existing metadata admission guard.

Swift opens READONLY, verifies read-only mode, never creates missing files, uses no busy wait, and finalizes statements/connections before returning. Fixed column names and bound parameters preserve the original SQL integer division and row ordering. The VM budget is one million steps, values/results at most 65,536 bytes, pages at most 200 rows, among batches at most 128 IDs with 512 UTF-8 bytes per ID and no NUL. Errors are constant codes, not SQL, file paths or row content.

The synchronous reader has no independently cancellable in-flight promise: cancellation/close can refuse subsequent admission, not retroactively interrupt a synchronous query on the same Node worker. VM-step bounds terminate expensive work. The main Swift loop stays separate. Session close and pre-start/live source cancellation remain covered by the existing regression suite; no prevention of already accepted platform writes is implied.

## Source-equivalent behavior in the admitted domain

- latest includes the maximum rowid and newest stamps even for messages with no chat join. Since pages use the original inner join and omit those unjoined messages.
- Unsent stamps count all messages; read stamps count only is_from_me = 1. A missing is_from_me column yields no read receipts.
- INTEGER nanoseconds divide by 1,000,000 in SQLite before comparison. The tie breaker is ROWID. A full page says more even when the following page is empty.
- Cursor normalization remains JavaScript Number/truncation/nonnegative coercion, including malformed array fallback and missing entries. Empty pages keep the normalized cursor.
- Null/numeric/text GUID and chat values retain the original JavaScript String conversion. Length-aware TEXT output retains embedded NUL; NUL input IDs are a declared refusal below.
- Missing optional stamp columns return empty pages and zero latest stamps; unavailable/malformed stores fail, rather than pretending to be empty.
- Marks persist without a native cache: repeat requests replay identically; closing/reopening preserves marks and changes made to a synthetic store while down remain visible.
- The unchanged engine consumes this reader for reset/head, unread/new-row suppression, unsent/read deltas, chat filtering and cursor advancement. Its history/live message mapping remains unchanged and is compared to the product reader.

## Differences, not silent product contract changes

The product reader directly accepts SQLite LIMIT 0, negative/unbounded values and sizes above 200. The experiment explicitly rejects zero, negative, fractional, non-number (including numeric-string) and above-200 limits. It also refuses unsafe/nonfinite normalized cursor numbers, oversized/NUL ID inputs, oversized result fields, unsupported SQLite BLOB cells and exhausted VM budgets. These failures are experiment safety constraints, not claims of complete production reader parity. Native schema discovery is per call, while the source caches columns until close; live schema migration during a session is not established parity. The product reader's close allows lazy reopen; the injected facade closes terminally, matching its session lifetime. The among result preserves Set membership, but splitting more than 128 IDs can change Set iteration order relative to one product SQL query; the unchanged engine consumes only has(). This observable experiment difference is not claimed as exact iteration-order parity. No adapter cutover is authorized by these results.

Source pathologies are not repaired here: repeated chat joins at one ROWID share the same cursor tie breaker, and REAL-valued fractional-millisecond marks are truncated by the next request's normalization. The source's SQL and normalization are retained, not strengthened into an exactly-once guarantee outside ordinary integer store timestamps and unique joins.

## Evidence ownership

changes.cjs compares latest, both since methods and unsentAmong on synthetic fixtures, including same-ms page boundaries, full/empty pages, replay, restart, offline mutation, optional schemas, null values, literal SQL-looking IDs and multi-batch IDs. It compares unchanged engine history/live and changes responses, reset and bad-cursor behavior. A deliberately missing unsent page must fail the cursor differential assertion; restored committed modules must pass on both relocated runtimes. ChangesTests cover read-only fixture bytes, tie boundaries, sender filtering, invalid shapes, absent noncreation, malformed schema and VM termination. No personal store or real send is exercised.
