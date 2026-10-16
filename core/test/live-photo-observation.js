// Test-only diagnostics. Event callbacks append timestamps; the sampling loop alone reads media and layout.
export function createLiveTrace(clock = Date.now) {
  const entries = [];
  return {
    entries,
    note(event) { if (entries.length < 256) entries.push({ event, at: clock() }); },
    has(event) { return entries.some((entry) => entry.event === event); },
  };
}

export function recordMediaEvent(trace, event) { trace.note('media:' + event.type); }

// Observe the function the app actually invokes, not a captured click. Preserve its receiver, arguments, return
// identity and errors. This seam exists only in the injected fixture, never in a production build.
export function traceCall(target, key, trace, name, include = () => true) {
  const original = target[key];
  target[key] = function (...args) {
    if (!include(this)) return original.apply(this, args);
    trace.note(name);
    let answer;
    try { answer = original.apply(this, args); }
    catch (error) { trace.note(name + ':threw'); throw error; }
    if (answer && typeof answer.then === 'function') {
      answer.then(() => trace.note(name + ':resolved'), () => trace.note(name + ':rejected'));
    } else trace.note(name + ':returned');
    return answer;
  };
  return () => { target[key] = original; };
}

export function livePhase(trace) {
  if (!trace.has('press-admitted')) return 'press-not-admitted';
  if (!trace.has('fetch-complete')) return 'motion-fetch-pending';
  if (!trace.has('mounted')) return 'motion-not-mounted';
  if (trace.has('play-called:rejected') || trace.has('play-called:threw')) return 'play-rejected';
  return 'motion-no-progress';
}

export function observeLiveMotion(stillBox) {
  let started = 0;
  let played = 0;
  let wrongBox = null;
  let last = null;
  let previousVideo = null;
  return {
    sample(video, box) {
      // The loop can resume after ended removed the video. Read its retained clock, never infer progress just
      // from removal. Geometry must have been sampled while it was mounted; a never-seen video cannot pass.
      if (!video) {
        if (started && previousVideo?.ended) played = Math.max(played, previousVideo.currentTime);
        return;
      }
      previousVideo = video;
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

export function recordMounts(trace, records) {
  const containsMotion = (node) => node.matches?.('video.viewer-motion') || node.querySelector?.('video.viewer-motion');
  for (const record of records) {
    if ([...record.addedNodes].some(containsMotion)) trace.note('mounted');
    if ([...record.removedNodes].some(containsMotion)) trace.note('removed');
  }
}
