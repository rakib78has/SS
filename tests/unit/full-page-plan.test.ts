import { describe, expect, it } from 'vitest';
import {
  captureScale,
  planFullPageCapture,
  type PageMetrics,
} from '../../src/core/capture/full-page-plan.js';
import { MAX_CANVAS_DIMENSION, MAX_SLICES } from '../../src/shared/constants.js';

function metrics(overrides: Partial<PageMetrics> = {}): PageMetrics {
  return {
    scrollHeight: 3000,
    viewportWidth: 1440,
    viewportHeight: 900,
    devicePixelRatio: 1,
    originalScrollX: 0,
    originalScrollY: 0,
    originalOverflow: '',
    ...overrides,
  };
}

describe('planFullPageCapture', () => {
  it('uses a single slice when the page fits in one viewport', () => {
    const plan = planFullPageCapture(metrics({ scrollHeight: 800, viewportHeight: 900 }));

    expect(plan.positions).toEqual([0]);
    expect(plan.truncated).toBe(false);
  });

  it('covers the whole page with full-viewport strides', () => {
    const plan = planFullPageCapture(metrics({ scrollHeight: 3000, viewportHeight: 900 }));

    expect(plan.positions).toEqual([0, 900, 1800, 2100]);
    expect(plan.truncated).toBe(false);
    expect(plan.capturedHeight).toBe(3000);
  });

  it('scales the canvas by the device pixel ratio', () => {
    const plan = planFullPageCapture(
      metrics({ scrollHeight: 1800, viewportHeight: 900, devicePixelRatio: 2 })
    );

    expect(plan.canvasHeight).toBe(3600);
  });

  // --- BUG-003 regression --------------------------------------------------
  // Spacing scroll stops further apart than one viewport does not "spread
  // coverage thinner"; each capture paints exactly one viewport, so the gap
  // between stops is simply never painted and appears as a blank band.
  describe('regression: no gaps between slices (BUG-003)', () => {
    it.each([
      { scrollHeight: 3000, viewportHeight: 900 },
      { scrollHeight: 50_000, viewportHeight: 900 },
      { scrollHeight: 120_000, viewportHeight: 768 },
      { scrollHeight: 7777, viewportHeight: 643 },
    ])(
      'never leaves a gap for a $scrollHeight px page in a $viewportHeight px viewport',
      ({ scrollHeight, viewportHeight }) => {
        const plan = planFullPageCapture(metrics({ scrollHeight, viewportHeight }));

        for (let i = 1; i < plan.positions.length; i++) {
          const stride = plan.positions[i] - plan.positions[i - 1];
          expect(stride).toBeGreaterThan(0);
          expect(stride).toBeLessThanOrEqual(viewportHeight);
        }
      }
    );

    it('paints every pixel of the canvas it allocates', () => {
      const viewportHeight = 900;
      const plan = planFullPageCapture(metrics({ scrollHeight: 10_000, viewportHeight }));

      // The last slice must reach the bottom of the allocated canvas.
      const lastPosition = plan.positions[plan.positions.length - 1];
      expect(lastPosition + viewportHeight).toBeGreaterThanOrEqual(plan.capturedHeight);
    });
  });

  // --- BUG-002 regression --------------------------------------------------
  // A 60-slice capture of a 900px viewport at dpr 2 wants 108,000px of canvas
  // height, well past Chrome's 65,535px per-dimension limit. The old code
  // allocated it anyway and produced an unusable canvas.
  describe('regression: respects the canvas height limit (BUG-002)', () => {
    it.each([
      { viewportHeight: 900, devicePixelRatio: 2 },
      { viewportHeight: 1080, devicePixelRatio: 3 },
      { viewportHeight: 640, devicePixelRatio: 1 },
    ])(
      'stays within the limit at dpr $devicePixelRatio',
      ({ viewportHeight, devicePixelRatio }) => {
        const plan = planFullPageCapture(
          metrics({ scrollHeight: 500_000, viewportHeight, devicePixelRatio })
        );

        expect(plan.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
        expect(plan.positions.length).toBeLessThanOrEqual(MAX_SLICES);
      }
    );

    it('reports truncation so the UI can tell the user', () => {
      const plan = planFullPageCapture(
        metrics({ scrollHeight: 500_000, viewportHeight: 900, devicePixelRatio: 2 })
      );

      expect(plan.truncated).toBe(true);
      expect(plan.capturedHeight).toBeLessThan(500_000);
    });

    it('does not report truncation when the whole page fits', () => {
      const plan = planFullPageCapture(metrics({ scrollHeight: 4500, viewportHeight: 900 }));
      expect(plan.truncated).toBe(false);
    });

    it('sizes the canvas to what was captured, not to the full page height', () => {
      const plan = planFullPageCapture(
        metrics({ scrollHeight: 500_000, viewportHeight: 900, devicePixelRatio: 2 })
      );

      // Overshooting to scrollHeight would leave a huge empty band at the
      // bottom of the stitched image.
      expect(plan.canvasHeight).toBe(Math.round(plan.capturedHeight * 2));
    });
  });

  describe('boundaries', () => {
    it('rejects non-positive metrics rather than allocating a broken canvas', () => {
      expect(() => planFullPageCapture(metrics({ viewportHeight: 0 }))).toThrow(RangeError);
      expect(() => planFullPageCapture(metrics({ scrollHeight: 0 }))).toThrow(RangeError);
      expect(() => planFullPageCapture(metrics({ devicePixelRatio: 0 }))).toThrow(RangeError);
    });

    it('de-duplicates positions when the final stride lands on the same offset', () => {
      const plan = planFullPageCapture(metrics({ scrollHeight: 1800, viewportHeight: 900 }));
      expect(new Set(plan.positions).size).toBe(plan.positions.length);
    });

    it('produces ascending positions', () => {
      const plan = planFullPageCapture(metrics({ scrollHeight: 9999, viewportHeight: 700 }));
      const sorted = [...plan.positions].sort((a, b) => a - b);
      expect(plan.positions).toEqual(sorted);
    });

    it('never scrolls past the maximum scroll offset', () => {
      const scrollHeight = 5000;
      const viewportHeight = 900;
      const plan = planFullPageCapture(metrics({ scrollHeight, viewportHeight }));

      for (const position of plan.positions) {
        expect(position).toBeLessThanOrEqual(scrollHeight - viewportHeight);
      }
    });
  });
});

// --- BUG-015 regression ------------------------------------------------------
// The stitcher positioned slices using window.devicePixelRatio. When the frames
// captureVisibleTab actually returns have a different scale — headless and
// remote-debugging contexts, some fractional-scaling setups, Chrome's own
// capture-size limits — slices were spaced further apart than they are tall,
// leaving unpainted bands. Found by the manual-QA harness at dpr 2, where
// captureVisibleTab returned 1x frames while the page reported 2.
describe('captureScale (BUG-015)', () => {
  it('derives the scale from the captured frame, not the reported ratio', () => {
    // Page claims 2x; the frame is actually 1x.
    expect(captureScale(800, 800, 2)).toBe(1);
  });

  it('agrees with the reported ratio when they match', () => {
    expect(captureScale(1600, 800, 2)).toBe(2);
    expect(captureScale(800, 800, 1)).toBe(1);
  });

  it('handles a fractional scale', () => {
    expect(captureScale(1200, 800, 1.5)).toBe(1.5);
  });

  it.each([
    ['zero bitmap width', 0, 800],
    ['negative bitmap width', -100, 800],
    ['NaN bitmap width', Number.NaN, 800],
    ['zero viewport width', 800, 0],
    ['NaN viewport width', 800, Number.NaN],
  ])('falls back to the reported ratio for %s', (_label, bitmapWidth, viewportWidth) => {
    expect(captureScale(bitmapWidth, viewportWidth, 2)).toBe(2);
  });

  it('keeps the stitched canvas consistent with the frames it holds', () => {
    // A 3600px page, 600px viewport, frames that are genuinely 1x.
    const plan = planFullPageCapture(metrics({ scrollHeight: 3600, viewportHeight: 600 }));
    const scale = captureScale(800, 800, 2); // page lies about being 2x

    const canvasHeight = Math.round(plan.capturedHeight * scale);
    const lastSliceBottom = plan.positions[plan.positions.length - 1] * scale + 600 * scale;

    // Every row of the canvas is covered by some slice.
    expect(lastSliceBottom).toBeGreaterThanOrEqual(canvasHeight);
    for (let i = 1; i < plan.positions.length; i++) {
      const gap = (plan.positions[i] - plan.positions[i - 1]) * scale;
      expect(gap).toBeLessThanOrEqual(600 * scale); // never exceeds a frame's height
    }
  });
});
