import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  describeStartFailure,
  PICKER_INTERACTION_FLOOR_MS,
} from '../../src/core/record/start-errors.js';
import { waitForVideoDimensions } from '../../src/core/record/video-ready.js';
import { ShareTimeoutError, withTimeout } from '../../src/core/record/with-timeout.js';

/** Minimal stand-in for a <video> fed by a MediaStream. */
function fakeVideo(initial: { width?: number; height?: number } = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const video = {
    videoWidth: initial.width ?? 0,
    videoHeight: initial.height ?? 0,
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
  };
  return {
    el: video as unknown as HTMLVideoElement,
    emit(type: string) {
      [...(listeners.get(type) ?? [])].forEach((fn) => fn());
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
    resolveTo(width: number, height: number) {
      video.videoWidth = width;
      video.videoHeight = height;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// --- BUG-016 regression ------------------------------------------------------
// startCapture waited unconditionally on `loadedmetadata`. By the time
// `play()` has resolved that event has normally already fired, so the listener
// never ran and the recorder hung: Start Recording stayed disabled, no view
// changed, and nothing explained why. Reported as "recording won't start".
describe('waitForVideoDimensions (BUG-016)', () => {
  it('resolves immediately when the dimensions are already known', async () => {
    const v = fakeVideo({ width: 1920, height: 1080 });

    await expect(waitForVideoDimensions(v.el)).resolves.toBeUndefined();
  });

  it('does not wait for an event that has already fired', async () => {
    // The deadlock case: metadata arrived before anyone started listening.
    const v = fakeVideo({ width: 1280, height: 720 });
    vi.useFakeTimers();

    const settled = vi.fn();
    void waitForVideoDimensions(v.el).then(settled);
    await Promise.resolve();

    expect(settled).toHaveBeenCalled();
    // Nothing should be left listening or pending.
    expect(v.listenerCount('loadedmetadata')).toBe(0);
  });

  it('resolves once dimensions arrive later', async () => {
    const v = fakeVideo();
    const promise = waitForVideoDimensions(v.el);

    v.resolveTo(800, 600);
    v.emit('loadedmetadata');

    await expect(promise).resolves.toBeUndefined();
  });

  it('also resolves on resize, which is what a stream fires', async () => {
    const v = fakeVideo();
    const promise = waitForVideoDimensions(v.el);

    v.resolveTo(640, 480);
    v.emit('resize');

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects rather than hanging when no video ever arrives', async () => {
    vi.useFakeTimers();
    const v = fakeVideo();

    const promise = waitForVideoDimensions(v.el, 5000);
    const assertion = expect(promise).rejects.toThrow(/never produced any video/);
    await vi.advanceTimersByTimeAsync(5001);

    await assertion;
  });

  it('removes every listener once settled', async () => {
    const v = fakeVideo();
    const promise = waitForVideoDimensions(v.el);
    v.resolveTo(100, 100);
    v.emit('loadedmetadata');
    await promise;

    for (const type of ['loadedmetadata', 'loadeddata', 'resize']) {
      expect(v.listenerCount(type)).toBe(0);
    }
  });

  it('ignores an event that fires while dimensions are still unknown', async () => {
    vi.useFakeTimers();
    const v = fakeVideo();
    const settled = vi.fn();
    void waitForVideoDimensions(v.el, 5000).then(settled, settled);

    v.emit('loadedmetadata'); // width is still 0
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5001);
  });
});

// --- BUG-006 follow-up -------------------------------------------------------
// The first fix only recognised a system block when Chrome's message happened
// to say "permission denied by system". It often does not, so genuine denials
// still produced total silence.
describe('describeStartFailure', () => {
  const slow = PICKER_INTERACTION_FLOOR_MS + 2000;
  const instant = 50;

  it('stays silent when the user dismisses the picker', () => {
    const error = new DOMException('Permission denied', 'NotAllowedError');

    expect(describeStartFailure(error, slow)).toBeNull();
  });

  it('speaks up when the request was refused too fast to be a person', () => {
    const error = new DOMException('Permission denied', 'NotAllowedError');

    expect(describeStartFailure(error, instant)).toMatch(/blocked before the share prompt/i);
  });

  it('names an OS-level block', () => {
    const error = new DOMException('Permission denied by system', 'NotAllowedError');

    expect(describeStartFailure(error, slow)).toMatch(/OS privacy settings/i);
  });

  it('names a policy block', () => {
    const error = new DOMException('Disallowed by policy', 'NotAllowedError');

    expect(describeStartFailure(error, slow)).toMatch(/browser policy/i);
  });

  it.each([
    ['NotFoundError', /No screen or window/i],
    ['NotReadableError', /Another application/i],
    ['InvalidStateError', /Reload the recorder tab/i],
    ['SecurityError', /SecurityError/],
  ])('explains %s', (name, pattern) => {
    expect(describeStartFailure(new DOMException('x', name), slow)).toMatch(pattern);
  });

  it('stays silent for a dismissed abort but not an instant one', () => {
    expect(describeStartFailure(new DOMException('', 'AbortError'), slow)).toBeNull();
    expect(describeStartFailure(new DOMException('', 'AbortError'), instant)).toMatch(
      /closed immediately/i
    );
  });

  it('passes through a plain Error', () => {
    expect(describeStartFailure(new Error('boom'), slow)).toBe('boom');
  });

  it('has something to say about a non-Error rejection', () => {
    expect(describeStartFailure('nope', slow)).toBe('Could not start screen capture.');
    expect(describeStartFailure(undefined, slow)).toBe('Could not start screen capture.');
  });
});

// --- BUG-017 regression ------------------------------------------------------
// The real cause of "recording won't start": getDisplayMedia does not always
// settle. When the picker cannot be shown, the promise can hang, so neither
// the success nor the failure branch runs and the UI is left on a disabled
// button with nothing on screen. Reproduced in a real browser.
describe('withTimeout (BUG-017)', () => {
  it('passes a value through when it arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('passes a rejection through unchanged', async () => {
    const error = new DOMException('denied', 'NotAllowedError');

    await expect(withTimeout(Promise.reject(error), 1000)).rejects.toBe(error);
  });

  it('rejects when the promise never settles', async () => {
    vi.useFakeTimers();

    const promise = withTimeout(new Promise(() => undefined), 5000);
    const assertion = expect(promise).rejects.toBeInstanceOf(ShareTimeoutError);
    await vi.advanceTimersByTimeAsync(5001);

    await assertion;
  });

  it('releases a stream granted after the timeout', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }, { stop }] };

    let grant: (s: typeof stream) => void = () => undefined;
    const pending = new Promise<typeof stream>((r) => (grant = r));

    const promise = withTimeout(pending, 5000, (late) => {
      late.getTracks().forEach((t) => {
        t.stop();
      });
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(ShareTimeoutError);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;

    grant(stream); // the browser finally hands over a stream
    await vi.advanceTimersByTimeAsync(0);

    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('does not leave a timer running once settled', async () => {
    vi.useFakeTimers();
    const settled = vi.fn();

    await withTimeout(Promise.resolve(1), 5000).then(settled);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(settled).toHaveBeenCalledTimes(1);
  });
});
