import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMediaDuration } from '../../src/core/record/webm-duration.js';

/** Stand-in for a <video> fed a MediaRecorder blob. */
function fakeVideo(initialDuration: number) {
  const listeners = new Map<string, Set<() => void>>();
  const el = {
    duration: initialDuration,
    currentTime: 0,
    addEventListener(type: string, fn: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn);
    },
  };
  return {
    el: el as unknown as HTMLVideoElement,
    emit(type: string) {
      [...(listeners.get(type) ?? [])].forEach((fn) => fn());
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
    /** What the browser does once it has scanned to the real end. */
    discoverDuration(seconds: number) {
      el.duration = seconds;
      this.emit('durationchange');
    },
    get seekTarget() {
      return el.currentTime;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// --- BUG-018 regression ------------------------------------------------------
// MediaRecorder writes WebM as a live stream, so the blob carries no Duration
// in its header and no cue index. The <video> fed that blob reported
// duration NaN/Infinity, an empty seekable range, and collapsed to "no
// supported sources" the moment anything seeked it — the preview went blank.
// Reported as "record video, when stop then disappear". Reproduced in a real
// browser: duration NaN, seekable 0, play() threw, 0 of 14400 pixels drawn.
describe('resolveMediaDuration (BUG-018)', () => {
  it('returns immediately when the duration is already known', async () => {
    const v = fakeVideo(12.5);

    await expect(resolveMediaDuration(v.el)).resolves.toBe(true);
    expect(v.listenerCount('durationchange')).toBe(0);
  });

  it.each([
    ['Infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
    ['zero', 0],
  ])('probes when the duration is %s', async (_label, duration) => {
    const v = fakeVideo(duration);

    const promise = resolveMediaDuration(v.el);
    v.discoverDuration(4.2);

    await expect(promise).resolves.toBe(true);
  });

  it('seeks far past the end so the browser scans to the real end', async () => {
    const v = fakeVideo(Number.POSITIVE_INFINITY);

    const promise = resolveMediaDuration(v.el);
    expect(v.seekTarget).toBeGreaterThan(1e100);

    v.discoverDuration(3);
    await promise;
  });

  it('returns the playhead to the start so the preview opens at the beginning', async () => {
    const v = fakeVideo(Number.POSITIVE_INFINITY);

    const promise = resolveMediaDuration(v.el);
    v.discoverDuration(3);
    await promise;

    expect(v.seekTarget).toBe(0);
  });

  it('also settles on timeupdate, which is what some builds fire', async () => {
    const v = fakeVideo(Number.POSITIVE_INFINITY);

    const promise = resolveMediaDuration(v.el);
    (v.el as unknown as { duration: number }).duration = 7;
    v.emit('timeupdate');

    await expect(promise).resolves.toBe(true);
  });

  it('gives up rather than hanging when the duration never resolves', async () => {
    vi.useFakeTimers();
    const v = fakeVideo(Number.POSITIVE_INFINITY);

    const promise = resolveMediaDuration(v.el, 5000);
    await vi.advanceTimersByTimeAsync(5001);

    await expect(promise).resolves.toBe(false);
  });

  it('gives up if the element errors while probing', async () => {
    const v = fakeVideo(Number.POSITIVE_INFINITY);

    const promise = resolveMediaDuration(v.el);
    v.emit('error');

    await expect(promise).resolves.toBe(false);
  });

  it('never rejects — an unmeasurable preview is still worth showing', async () => {
    vi.useFakeTimers();
    const v = fakeVideo(Number.NaN);

    const promise = resolveMediaDuration(v.el, 1000);
    v.emit('error');

    await expect(promise).resolves.toBe(false);
  });

  it('removes every listener once settled', async () => {
    const v = fakeVideo(Number.POSITIVE_INFINITY);

    const promise = resolveMediaDuration(v.el);
    v.discoverDuration(2);
    await promise;

    for (const type of ['durationchange', 'timeupdate', 'error']) {
      expect(v.listenerCount(type)).toBe(0);
    }
  });

  it('ignores a durationchange that still reports no usable length', async () => {
    vi.useFakeTimers();
    const v = fakeVideo(Number.POSITIVE_INFINITY);
    const settled = vi.fn();

    void resolveMediaDuration(v.el, 3000).then(settled);
    v.emit('durationchange'); // still Infinity
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3001);
  });
});
