/** How long to wait for a shared surface to report its dimensions. */
export const VIDEO_READY_TIMEOUT_MS = 10_000;

/**
 * Resolves once a video element knows its dimensions.
 *
 * Waiting on `loadedmetadata` alone deadlocks: by the time `play()` has
 * resolved that event has usually already fired, so a listener added
 * afterwards never runs and the recorder hangs on a disabled button with no
 * error. Checking the current state first, listening for `resize` as well
 * (which is what fires when a stream's dimensions become known later), and
 * failing loudly on a timeout removes every one of those dead ends.
 */
export function waitForVideoDimensions(
  video: HTMLVideoElement,
  timeoutMs: number = VIDEO_READY_TIMEOUT_MS
): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        cleanup();
        resolve();
      }
    };
    const onTimeout = () => {
      cleanup();
      reject(new Error('The shared screen never produced any video. Try sharing it again.'));
    };
    const timer = setTimeout(onTimeout, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', check);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('resize', check);
    };

    video.addEventListener('loadedmetadata', check);
    video.addEventListener('loadeddata', check);
    video.addEventListener('resize', check);
    check(); // in case the dimensions arrived between the guard and here
  });
}
