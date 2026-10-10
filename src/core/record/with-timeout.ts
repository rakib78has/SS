/**
 * How long to wait for the share prompt before giving up.
 *
 * Generous on purpose: choosing a window from the picker is a human action and
 * people take their time. This exists only to catch a request that never
 * settles at all, not to hurry anyone along.
 */
export const SHARE_PROMPT_TIMEOUT_MS = 90_000;

export class ShareTimeoutError extends Error {
  constructor() {
    super(
      'The screen-sharing prompt never responded. Reload the recorder tab and try again — if it keeps happening, check your OS screen-recording permission for Chrome.'
    );
    this.name = 'ShareTimeoutError';
  }
}

/**
 * Rejects if `promise` has not settled within `timeoutMs`.
 *
 * `getDisplayMedia` does not always resolve or reject. When the picker cannot
 * be shown at all, the returned promise can simply hang, so both the success
 * and failure branches are skipped and the UI is left on a disabled button
 * with nothing to explain it — which is exactly what "recording won't start"
 * looks like from the outside.
 *
 * `onLateSettle` releases anything that arrives after the timeout, so a stream
 * granted too late does not leave the browser believing a capture is live.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onLateSettle?: (value: T) => void
): Promise<T> {
  let timedOut = false;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new ShareTimeoutError());
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        if (timedOut) onLateSettle?.(value);
        else resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        // DOMException extends Error, so the original rejection — which the
        // caller inspects by name — passes through untouched.
        if (!timedOut) reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}
