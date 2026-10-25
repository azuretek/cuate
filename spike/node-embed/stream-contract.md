# Disposable in-process stream contract

This extends the embedding feasibility source, not the shipped server or a selected production runtime. C++ owns the isolate callbacks, Swift owns the NativeEngine task, and both live in the signed executable's PID. No helper listener, executable or token is introduced.

## Ownership and limits

- Open reserves one generation before Swift can emit. At most eight sessions exist. A duplicate id or ninth session is refused. JavaScript retains callbacks until terminal delivery; native task drain precedes that terminal callback.
- Input is a bounded oldest-first queue of 32 lines, each at most 65,536 UTF-8 bytes. Write statuses are 0 accepted, 1 full (not accepted), 2 closed/unknown, 3 oversized/invalid. No refusal claims that a request was accepted.
- Output strings are copied while the Swift C string is valid, under the same mutex as uv_async publication. At most 64 ordinary queued outputs plus eight reserved terminal notifications exist. Oversized output or full output admission cancels its native source and reports terminal overflow rather than silently losing data.
- Callbacks execute only on the owning isolate. Native EOF stops admission and drains accepted work; cancellation also cancels the task. Cancellation does not establish that an accepted platform write was prevented. The existing server's uncertain-send classification remains required.
- Terminal statuses are 0 drained EOF, 1 cancelled/source failure, 3 output backpressure, 4 JavaScript callback failure. Source failure and cancellation remain combined in this feasibility ABI; production diagnostics need a typed distinction. Once terminal delivery removes the generation, no callback can use it. Callback failure suppresses subsequent ordinary delivery while native cancellation drains.
- On forced Node exit, JavaScript callbacks are abandoned, every native session is cancelled, and the existing five-second native drain deadline remains enforced. Native state and uv_async outlive the terminal producers.

## Test seams, not platform replacements

The explicit Swift synthetic engine implements only status, watch subscribe/unsubscribe, a synthetic event trigger, chat listing and history. It simulates an uncertain send response without any platform write, and refuses other mutation methods. It exists to inject stream events through unchanged createEngine, HTTP auth, sender policy, API client and authenticated WebSocket code without touching personal data. A fixture event is not proof of an actual platform watch. The pinned LibraryEngine separately exercises its real IMsgRPCServer watch over a disposable synthetic SQLite database.

The JavaScript transport is a spike adapter, not wired into the production command or installed service. The main server still uses its current platform backend. Rich text, edits, changes, backgrounds, members, renames, voice metadata, effects, Contacts, power, media, setup/menu, capabilities and release/updater cutover retain their full obligations. No production selection, TCC proof, signing/notarization acceptance, personal-store write or real send follows from these tests.
