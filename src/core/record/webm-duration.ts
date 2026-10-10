/** How long to wait for the browser to work out a recording's real length. */
export const DURATION_PROBE_TIMEOUT_MS = 5000;

/**
 * Makes a `MediaRecorder` recording seekable in a `<video>` element.
 *
 * MediaRecorder writes WebM as a live stream, so the file carries no Duration
 * in its header and no cue index. A `<video>` fed that blob reports a duration
 * of `Infinity` (or `NaN`), exposes an empty `seekable` range, and breaks
 * outright the moment anything seeks it — the element drops to "no supported
 * sources" and the preview goes blank. From the outside that looks exactly
 * like the recording vanishing as soon as you stop.
 *
 * Seeking far past the end forces the browser to scan to the real end, at
 * which point it knows the duration and the scrubber starts working. It is a
 * well-worn workaround, and the alternative — rewriting the EBML header to
 * insert a Duration element — would mean adding the only runtime dependency in
 * the project for something the browser can already work out for itself.
 *
 * Resolves either way: a preview that cannot be measured is still worth
 * showing, and the download is unaffected regardless.
 */
export function resolveMediaDuration(
  video: HTMLVideoElement,
  timeoutMs: number = DURATION_PROBE_TIMEOUT_MS
): Promise<boolean> {
  if (Number.isFinite(video.duration) && video.duration > 0) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    const settle = (ok: boolean) => {
      cleanup();
      // Put the playhead back so the preview opens at the start.
      try {
        video.currentTime = 0;
      } catch {
        // A video that cannot seek at all is still playable from the start.
      }
      resolve(ok);
    };

    const onProgress = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) settle(true);
    };

    const timer = setTimeout(() => settle(false), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('durationchange', onProgress);
      video.removeEventListener('timeupdate', onProgress);
      video.removeEventListener('error', onError);
    };
    const onError = () => settle(false);

    video.addEventListener('durationchange', onProgress);
    video.addEventListener('timeupdate', onProgress);
    video.addEventListener('error', onError);

    try {
      // Far beyond any real recording: the browser clamps to the true end.
      video.currentTime = 1e101;
    } catch {
      settle(false);
    }
  });
}
