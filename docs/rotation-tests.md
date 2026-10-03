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
  report is retained with the boot proof.

Each orientation must settle with the same message id and vertical offset within
two CSS pixels, unchanged draft and collapsed caret selection, and the original
focused textarea. A mutation observer latches an empty or replaced conversation
as a failure even when it recovers before the final assertion. The native tests
also require the page dimensions to change orientation, so an ignored rotation
cannot pass. The fixture never restores the anchor or the draft itself. The iOS
screenshot of each orientation is taken only once the window and web view have
turned, the web view fills the window, and consecutive screenshots match, so a
frame caught mid-rotation is never kept as proof and a clipped layout fails. The
capture is of the whole screen, turned upright: the app's own screenshot crops a
landscape screen by the app's portrait frame, which Xcode saved on its side and
cut in half, and which read as a clipped layout that is not there. The screen as
the simulator returned it is kept beside it as `landscape-as-returned`.

Run with the existing iOS scheme's test action or, from android,
`./gradlew --no-daemon :app:connectedDebugAndroidTest`.
