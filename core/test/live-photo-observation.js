// Test-only observations survive the viewer removing its short motion at ended (issue 402).
// A missing element is not proof that it never played. Keep measured progress, not an inferred success.
export function observeLiveMotion(stillBox) {
  let started = 0;
  let played = 0;
  let wrongBox = null;
  let last = null;
  return {
    sample(video, box) {
      if (!video) return;
      const b = box(video);
      if (!wrongBox && (Math.abs(b.w - stillBox.w) > 1 || Math.abs(b.h - stillBox.h) > 1)) wrongBox = b;
      last = { ready: video.readyState, t: video.currentTime, paused: video.paused, ended: video.ended, error: video.error?.code ?? null, box: b };
      if (!started && video.currentTime > 0.3 && !video.paused) started = video.currentTime;
      if (started) played = Math.max(played, video.currentTime);
    },
    get passed() { return started > 0 && played > started + 0.2; },
    get played() { return played; },
    get wrongBox() { return wrongBox; },
    get last() { return last; },
  };
}
