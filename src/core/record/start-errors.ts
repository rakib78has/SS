/**
 * Turns a `getDisplayMedia` rejection into something worth showing the user.
 *
 * Chrome raises `NotAllowedError` both when the user dismisses the share
 * picker — which needs no message — and when capture is denied outright by
 * the operating system, an enterprise policy, or a permissions policy, which
 * very much does. The message text differs between platforms and versions, so
 * matching on it is unreliable and previously left genuine denials completely
 * silent.
 *
 * Elapsed time separates them far more dependably: dismissing a dialog takes a
 * person a moment, whereas a blocked request rejects almost immediately
 * because no picker is ever shown.
 */

/** Below this, the rejection came back too fast for a human to have acted. */
export const PICKER_INTERACTION_FLOOR_MS = 400;

export function describeStartFailure(error: unknown, elapsedMs: number): string | null {
  if (!(error instanceof DOMException)) {
    return error instanceof Error && error.message
      ? error.message
      : 'Could not start screen capture.';
  }

  switch (error.name) {
    case 'NotAllowedError': {
      const text = error.message.toLowerCase();
      if (text.includes('system')) {
        return 'Your system blocked screen recording. Allow screen recording for Chrome in your OS privacy settings, then try again.';
      }
      if (text.includes('policy') || text.includes('disallowed') || text.includes('disabled')) {
        return 'Screen recording is blocked by a browser policy on this device.';
      }
      // No picker could have been shown and dismissed this quickly.
      if (elapsedMs < PICKER_INTERACTION_FLOOR_MS) {
        return 'Screen recording was blocked before the share prompt appeared. Check your OS screen-recording permission for Chrome, and any browser policy.';
      }
      return null; // the user dismissed the picker
    }
    case 'AbortError':
      return elapsedMs < PICKER_INTERACTION_FLOOR_MS
        ? 'The share prompt closed immediately. Screen recording may be unavailable on this device.'
        : null;
    case 'NotFoundError':
      return 'No screen or window was available to record.';
    case 'NotReadableError':
      return 'Another application is using the screen capture device.';
    case 'InvalidStateError':
      return 'The page was not ready to start recording. Reload the recorder tab and try again.';
    case 'TypeError':
      return 'This browser rejected the screen-capture request.';
    default:
      return `Could not start screen capture (${error.name}).`;
  }
}
