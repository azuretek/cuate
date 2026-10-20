# In-process Node embedding feasibility (#479)

This is a disposable macOS prototype, not the server's selected runtime or release packaging. Production source is unchanged. Use an existing shared Node build; this spike never installs Node or changes a service or grant. Linux/Windows builds do not use it or need Swift.

## Candidate compatibility

Measured candidate: Node 26.7.0, ABI 147. The repository declares node >=22.13 and CI uses 24. check.py asserts the engine lower bound and this exact candidate; it runs unchanged server tests inside the embedded runtime rather than treating semver as compatibility proof. A 24-series shared build must still be measured before selecting the product version. The C++ embedding ABI can change each major: the first build reproduced InitializeOncePerProcess returning shared_ptr rather than the older example's unique_ptr. The stored type now follows the actual public return type. Pin/retest the whole runtime, headers and dylib closure together.

## Reproduce

On an approved quiet Apple build host with Xcode and an existing Node shared-library prefix:

~~~sh
python3 spike/node-embed/build.py --node-prefix "$NODE_PREFIX" --output "$SCRATCH/package"
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

CFRunLoop is not a witnessed AppKit setup/menu. No platform messaging or address-book library or permissions are exercised. No Developer ID/hardened-runtime/notarization, shipped dependency manifest/license review, updater migration, macOS minimum/CPU matrix or long soak is proven. Cancellation here rejects a synthetic result; it is not proof that a real messaging write can be cancelled safely. Direct V8 bindings must remain isolated behind the native interface and revalidated per Node major.

Next: make the native host interface explicit and injectable, consume pinned imsg libraries in-process, exercise richer shutdown/forced-error cases and a supported 24-series shared build; then run the full platform/release gates and all twenty #479 acceptance obligations. No helper socket or second service is reintroduced.
