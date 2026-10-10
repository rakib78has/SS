# Changelog

All notable changes to SnapCapture are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The recording appeared to vanish when you pressed stop.** MediaRecorder
  writes WebM as a live stream, so the blob carries no duration in its header
  and no cue index. The preview element reported a duration of `NaN`, exposed
  no seekable range, and collapsed to "no supported sources" the moment
  anything scrubbed it — leaving a blank player. The recording itself was
  always intact; only the preview was unusable. The length is now measured
  after loading, which restores the scrubber. An empty recording is also
  reported plainly instead of showing a blank player. (BUG-018)

- **"Recording won't start": the recorder could hang with no explanation.**
  `getDisplayMedia` does not always settle — when the share picker cannot be
  shown, the promise can simply never resolve or reject, so neither the success
  nor the failure branch ran. The Start Recording button stayed disabled, no
  view changed, and nothing appeared on screen. Reproduced in a real browser.
  The request is now bounded, and a stream granted after the timeout is
  released rather than leaving the browser believing a capture is live.
  (BUG-017)
- **A second hang on the same path.** After `play()` resolved, the code waited
  unconditionally for `loadedmetadata`. That event has normally already fired
  by then, so the listener never ran and the recorder hung in the same visible
  way. It now checks the current state first, also accepts `resize` — which is
  what a stream fires when its dimensions become known — and fails loudly on a
  timeout instead of waiting forever. (BUG-016)
- **Screen-capture denials were still silent.** The earlier fix only recognised
  an OS-level block when Chrome's message happened to say "permission denied by
  system", which it often does not. Denials are now identified by how quickly
  the request came back — a dismissed picker takes a person a moment, a blocked
  request rejects immediately — as well as by policy and system wording.
  (BUG-006 follow-up)

### Fixed

- **Full-page capture could still produce blank bands, by a second route.** The
  stitcher positioned slices using `window.devicePixelRatio`, but the frames
  `captureVisibleTab` actually returns do not always have that scale — headless
  and remote-debugging contexts, some fractional-scaling setups, and Chrome's
  own capture-size limits can all return a differently scaled frame. Slices were
  then spaced further apart than they are tall, leaving rows that were never
  painted: the same corruption BUG-003 addressed, arriving another way. The
  scale is now measured from the captured frame instead of taken on trust.
  Found by the manual-QA harness at dpr 2, where `captureVisibleTab` returned
  1x frames while the page reported 2. (BUG-015)

## [0.2.0]

Rebuilt on TypeScript with a tested core. No change to the permission set, and
still no host permissions.

### Fixed

- **The editor could crash the tab after a handful of annotations.** Undo stored
  a full-canvas `ImageData` per operation. On a 2880×20000 device-pixel capture
  that is roughly 230 MB each, and the fifteen it retained came to about 3.4 GB
  — the tab died long before reaching the limit. History now stores the
  operations and re-renders from the original bitmap, so memory is proportional
  to how much you drew rather than to the size of the image. The depth cap is
  gone as a result, and undo is exact rather than a replayed snapshot. (BUG-001)
- **Full-page capture produced an unusable image on very long pages.** The slice
  plan ignored Chrome's 65,535 px limit on a single canvas dimension; a 60-slice
  capture at a 2× device pixel ratio asked for 108,000 px. The plan is now
  bounded by that limit and reports when a page was too long to capture
  completely. (BUG-002)
- **Full-page capture left blank bands on long pages.** Scroll stops were spread
  evenly across the page, on the assumption that this thinned coverage out. It
  does not — each capture paints exactly one viewport, so everything beyond that
  stride was never painted at all. The stride is now clamped to one viewport.
  (BUG-003)
- **Recordings froze when you switched tabs.** The recorder composited frames
  through `requestAnimationFrame`, which stops firing entirely in a hidden tab.
  Since the feature exists to record *another* window, switching away was the
  normal case — and the timer kept counting while the UI still said "recording",
  so the failure stayed invisible until playback. Frames now come from
  `requestVideoFrameCallback`, with an interval fallback and a warning in the UI
  when that fallback is in use. (BUG-004)
- **Screenshots could be lost between capture and the editor.** The image lived
  only in service-worker memory, and MV3 evicts workers aggressively; an
  eviction before the editor loaded lost it permanently. Unclaimed captures also
  leaked for the worker's lifetime. The handoff is now IndexedDB-backed with a
  TTL sweep. (BUG-005)
- Screen-recording failures were silently swallowed as "user cancelled", so a
  policy block or a device error produced no feedback at all. (BUG-006)
- Malformed selection geometry reached canvas-sizing arithmetic, surfacing as an
  opaque allocation failure. Every message that crosses a trust boundary is now
  validated at runtime. (BUG-007)
- Colour swatches were empty buttons with no accessible name, announcing only as
  "button". They now carry labels and pressed state. (BUG-008)
- Page height was measured before the scrollbar was hidden, so the reflow left
  the measurement stale and the stitched image overshot. (BUG-009)
- Fixed and sticky elements were hidden once, at the second slice, so anything
  mounted later still repeated down the image. Now re-run per slice. (BUG-010)
- A slow read of the saved export format could overwrite a choice the user had
  already made. The control stays disabled until the preference has loaded.
  (BUG-013)

### Added

- Keyboard undo and redo in the editor (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`,
  `Ctrl/Cmd+Y`), and `Escape` to cancel a pending crop. (BUG-012)
- Redo, alongside undo.
- Undo for recorder annotations.
- An explicit Content Security Policy, including `frame-ancestors 'none'`.
- `minimum_chrome_version: 116`.
- `Escape` and window blur now dismiss a stranded selection overlay.
- The recorder releases screen capture when its tab closes, so Chrome stops
  showing the sharing indicator.

### Changed

- Rebuilt in TypeScript on Vite, split into layers: `core/` holds pure logic and
  never imports `chrome.*`; `infra/` is the only place that does.
- 193 unit and integration tests plus 29 Playwright end-to-end tests, with 98.7%
  line coverage on the logic layers. Every fixed defect has a regression test.
- CI runs formatting, lint, type checking, tests, build, manifest validation, a
  dependency audit and the E2E suite.
- `npm run validate:manifest` fails if the permission set grows without a
  matching, justified change.

## [0.1.0]

Initial version: visible, full-page, area and delayed capture; an annotation
editor with PNG, JPG and PDF export; and a screen recorder.
