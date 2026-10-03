# Native conversation rotation proof

The existing iOS and Android PR pipelines run a populated conversation through
portrait, landscape and portrait again. This is native device rotation, not a CSS
viewport resize. The shared fixture injects synthetic records into the real app
components after empty-storage onboarding; it uses no server, token or account.

- iOS: the Debug-only launch argument installs the shared test script. The Release
  build compiles out the seam and never copies the script. The generated UI-test
  target runs with the existing scheme's test action. XCTest screenshots and test
  results are retained in the boot-proof artifact's rotation result bundle.
- Android: instrumentation injects the script from the test APK into the real
  activity's WebView. No intent, bridge command or fixture is added to the shipped
  application. The existing connectedDebugAndroidTest task runs the test and its
  report is retained with the boot proof. Light and dark screenshots use the
  runner-provided `additionalTestOutputDir`: AGP copies it to the host before
  uninstalling the app. App external files are deleted by that uninstall, so
  pulling them after the task completes loses the proof. CI requires both
  retained screenshots to be nonempty and uploads the managed output directory.

Each orientation must settle with the same message id and vertical offset within
two CSS pixels, unchanged draft and collapsed caret selection, and the original
focused textarea. A mutation observer latches an empty or replaced conversation
as a failure even when it recovers before the final assertion. A sample that has
not yet counted ten frames at one width reports `:settling` and draws a neutral
fill, never `:fail`: right after a turn the page is still reflowing, and a
verdict must not claim a failure the page never had (issue 201). The fixture also
draws its last sample as a one-pixel accessible `rotation-diagnosis` element, so
a native dump names the failing checks, the sample the verdict last failed on and
the frame counter. The native tests also require the page dimensions to change
orientation, so an ignored rotation cannot pass. The fixture never restores the anchor or the draft itself. The iOS
screenshot of each orientation is taken only once the window and web view have
turned, the web view fills the window, and consecutive screenshots match, so a
frame caught mid-rotation is never kept as proof and a clipped layout fails. The
capture is of the whole screen, turned upright: the app's own screenshot crops a
landscape screen by the app's portrait frame, which Xcode saved on its side and
cut in half, and which read as a clipped layout that is not there. The screen as
the simulator returned it is kept beside it as `landscape-as-returned`.

The iOS CI test command runs once through `ios/scripts/test-with-diagnostics.mjs`.
It preserves the test exit status and keeps stdout, stderr, timestamped process
snapshots, unprivileged one-second launch-process samples and filtered system logs
in `proof/launch-diagnostics`, uploaded even on failure. Each diagnostic command
has a five-second bound and the test command has a twenty-minute deadline.
Sampling failures are recorded, not treated as passing tests. No retries or
rotation assertions are removed. These captures diagnose launch handshakes that
can time out before the first app or rotation assertion starts.

Run with the existing iOS scheme's test action or, from android,
`./gradlew --no-daemon :app:connectedDebugAndroidTest`.
