# In-process Node embedding feasibility (#479)

This is a disposable macOS prototype, not the server's selected runtime or release packaging. Production source is unchanged. Use an existing shared Node build; this spike never installs Node or changes a service or grant. Linux/Windows builds do not use it or need Swift.

## Candidate compatibility

Measured candidate: Node 26.7.0, ABI 147. The repository declares node >=22.13 and CI uses 24. check.py asserts the engine lower bound and this exact candidate; it runs unchanged server tests inside the embedded runtime rather than treating semver as compatibility proof. A 24-series shared build must still be measured before selecting the product version. The C++ embedding ABI can change each major: the first build reproduced InitializeOncePerProcess returning shared_ptr rather than the older example's unique_ptr. The stored type now follows the actual public return type. Pin/retest the whole runtime, headers and dylib closure together.

## Reproduce

On an approved quiet Apple build host with Xcode and an existing Node shared-library prefix:

~~~sh
swift test --package-path spike/node-embed/NativeHost --scratch-path spike/node-embed/NativeHost/out --disable-automatic-resolution --jobs 2
python3 spike/node-embed/build.py --node-prefix "$NODE_PREFIX" --native-library spike/node-embed/NativeHost/out/debug/libEmbeddedNativeHost.dylib --output "$SCRATCH/package"
cp -R "$SCRATCH/package" "$SCRATCH/relocated"
python3 spike/node-embed/check.py --package "$SCRATCH/relocated" --repo "$PWD" --logs "$SCRATCH/results"
~~~

Output directories must not already exist. Every child command has a deadline. Logs contain synthetic data, but local loader/compiler paths must be redacted before publication. No build output belongs in git. build.py copies the dylib closure, rewrites local loader paths and ad-hoc signs each image; check.py uses a fresh temporary HOME, PATH=/usr/bin:/bin and actual loader traces to assert packaged libnode and refuse ambient Homebrew runtime libraries. JS server/test dependencies still come from the explicit worktree, not a complete shipped app artifact.

## What is tested

- Node's maintained InitializeOncePerProcess, CommonEnvironmentSetup, default LoadEnvironment entry point, SpinEventLoop, Stop and teardown, plus MultiIsolatePlatform for workers.
- Swift owns the main CFRunLoop; Node runs on a non-main OS thread. A real timer proves the main loop progresses.
- Supported V8 function bindings bridge JS promises to asynchronous main-queue Swift work and back through uv_async. Swift preconditions assert thread affinity; returned process IDs equal the JS and host PID.
- Thirty-two concurrent native replies, immediate cancellation, repeated/unknown cancellation, invalid delay, same-PID worker, SQLite query, and unchanged fake-server ESM boot, scoped HTTP and real authenticated event WebSocket.
- SIGTERM completion goes through the async native seam. A cancelled native completion stays referenced until its callback is consumed, without re-resolving its rejected promise or freeing its uv handle early.
- Existing API, service, update, backup, artifact and fixture files run unchanged, one embedded process per file. The service tests' deliberate CLI children use this same embedded executable. These are bounded test commands, not another production server/helper process.

The default LoadEnvironment entry point is deliberate. A custom require bootstrap failed on main.js top-level await; a subsequent ESM wrapper still broke Node -e token-handoff tests. Neither wrapper survives in this prototype. Loader tracing is removed from the environment after startup so nested CLI tests do not receive diagnostic stderr that would change their output contract.

## Limits and next step

CFRunLoop is not a witnessed AppKit setup/menu. The pinned native libraries are linked and exercised against synthetic data only; no live platform database, write, address-book lookup or permission is exercised. No Developer ID/hardened-runtime/notarization, shipped dependency manifest/license review, updater migration, macOS minimum/CPU matrix or long soak is proven. Cancellation here rejects a synthetic result; it is not proof that a real messaging write can be cancelled safely. Direct V8 bindings must remain isolated behind the native interface and revalidated per Node major.

The pinned 24.21.0 shared build and 26.7.0 candidate passed relocated runtime feasibility. Next: finish native platform reader/framework parity and product cutover; then run the full platform/release gates and all twenty #479 acceptance obligations. No helper socket or second service is reintroduced.

## Native host and forced failures

NativeHost pins imsg 0.17.0-cuate.1 at revision 4aa95deb46ddbd92419b3b47717d9bf8acbca3d3, with the transitive lockfile committed. NativeEngine is injectable; LibraryEngine calls IMsgRPCServer.run(lines:) directly, receiving RPCWriter lines in memory. A finite-batch C entry point copies request strings before asynchronous work and sends one terminal callback only after the engine drains. The C++ bridge copies that callback before its C string expires and resolves on the owning isolate through uv_async. No imsg command, stdin pipe, helper process or socket is involved.

Five Swift tests cover fake drain/source failure and actual-library dispatch, source failure and cancellation. library.cjs asserts 16 concurrent unknown-method replies, then creates a synthetic SQLite database and reads one message through the actual pinned core/RPC libraries. The returned native PID must equal the JS/Swift PID. These are read/dispatch proofs, not safe real-write proofs. The original host_rpc entry point remains finite-batch. The additional bounded stream entry points preserve a native session across requests and notifications; see stream-contract.md for ownership and explicit test-only injection limits. Product backend cutover and complete platform reader parity remain open. Cancelling a JS promise does not claim cancellation of a native write.

The original default process exit handler terminated before returning to Swift when an uncaught JS error had a pending native callback. Forced runtime throw, load-time throw and explicit process.exit(7) now stop JS admission, preserve their exit status, drain outstanding terminal callbacks without resolving abandoned promises, close uv handles, and return to Swift. A five-second native-drain failsafe exits70 with FORCED_NATIVE_DRAIN_TIMEOUT rather than hang indefinitely. The checker expects nonzero statuses1/7/1 for these intentional failures and requires FORCED_NATIVE_DRAIN_PASS, main-loop ticks and bundled-loader assertions; an error is not counted as a normal successful exit.


## Bounded native streams

The stream-contract.md file defines session admission, input/output backpressure, terminal ownership and forced-exit drain. NativeSession accepts an injectable NativeEngine. stream.cjs connects a Swift synthetic source to the unchanged server createEngine, HTTP routes, API client, authenticated WebSocket and state store. It checks refused unauthorized/sending-off requests, synthetic uncertain-send dedup across engine restart, event/history parity and source drain. library.cjs separately keeps the actual pinned IMsgRPCServer alive across requests and checks subscribe, synthetic SQLite updates and unsubscribe. The watch cursor zero means live-from-head in the pinned library; the replay fixture deliberately starts from a nonzero known cursor.

This is not a live database or a product backend replacement. Production main.js still uses its existing platform adapter. A Swift synthetic event is not evidence for platform reader coverage; complete reader/framework migration, setup/menu, typed capabilities, signing, TCC, updater retention and soak remain open.

## Supplemental native metadata

metadata-contract.md maps every production native dependency to its current evidence and remaining port. The voices, rename and send-effect readers now have a bounded Swift read-only implementation injected through the unchanged synchronous among() seam, tied to an admitted library session. metadata.cjs compares their results with the unchanged product readers and asserts downstream model consumption; no production setup or reader is replaced yet. These experiments preserve Node 24 as a supported engineering candidate, not a product runtime selection.

## Supplemental change cursors

change-contract.md declares the session-bound native read/unsent cursor port and its explicit experiment-only safety refusals. changes.cjs compares it to the unchanged product reader and unchanged engine consumers, including replay/restart, offline synthetic updates, tie boundaries and malformed/unavailable stores. Production wiring, API behavior and runtime selection are unchanged.
