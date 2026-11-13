# Performance

## Measuring

`scripts/measure.mjs` launches the production build under Electron and samples `app.getAppMetrics()` once a second. Build first:

```sh
npm run build
node scripts/measure.mjs --label before          # all scenarios, 25 s each
node scripts/measure.mjs --label after --only b,d --seconds 20 --runs 2
```

The hook lives in `electron/measure.cjs`. `main.cjs` only loads it when `STRATUS_MEASURE=1`, and the harness sets that for you. In that mode the window never appears on screen and the app gets no dock icon, so it never takes focus. Audio is muted with `--mute-audio`, but the full playback pipeline still runs. Every scenario except (c) renders offscreen (`webPreferences.offscreen`), which runs the whole renderer at 60 fps without a native window. Scenario (c) uses a real window that is never shown. Each scenario starts a fresh Electron with a throwaway profile.

Columns are mean CPU (percent of one core) and mean working set, split by process type. "GPU busy" is Metal GPU time for the app's processes, read from the `AGXDeviceUserClient` entries in `ioreg`. It catches work like blur filters that never shows up as CPU. The harness also reports the JS heap after a forced GC, whether the audio clock advanced during the sample, `document.visibilityState`, and startup timings. Raw samples go to a `.jsonl` file next to the summary JSON in the temp directory.

Offscreen rendering isn't identical to an on-screen window. Compositing happens in software and frames are copied to the browser process, so treat the numbers as relative, not absolute.

Scenarios:

- a. Idle on Home, nothing playing.
- b. Playing a chart track from Home, Home visible.
- c. Playing, window hidden.
- d. Playing with the immersive player open.
- e. Stream scrolled to the middle of about 30 entries, playing one that's on screen.
- f. Memory before and after visiting 15 pages and skipping through 10 tracks, opening immersive along the way.

## Baseline

Apple M4 Pro, 24 GB, Electron 45.3.2, one run of 25 one-second samples per scenario, before any changes.

| Scenario | CPU % total | renderer | GPU proc | browser | Memory MB total | renderer | GPU | browser | wakeups/s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a. Idle on Home | 0.0 | 0.0 | 0.0 | 0.0 | 445 | 137 | 110 | 154 | 3 |
| b. Playing, Home | 1.3 | 1.0 | 0.2 | 0.0 | 612 | 199 | 120 | 211 | 112 |
| c. Playing, hidden | 2.3 | 1.8 | 0.4 | 0.0 | 546 | 201 | 107 | 156 | 205 |
| d. Playing, immersive | 2.5 | 1.0 | 1.0 | 0.5 | 771 | 201 | 116 | 381 | 240 |
| e. Playing, Stream | 0.4 | 0.2 | 0.1 | 0.1 | 548 | 185 | 107 | 182 | 65 |

Startup in the baseline was about 350 to 380 ms from main-process start to `ready-to-show`. First contentful paint came about 130 ms after renderer navigation start, and Home finished rendering about 340 to 380 ms after it.

Earlier short runs (5 to 6 s each) also recorded GPU busy time. With an on-screen window, b was 2.8%, d was 8.3%, and a hidden window with `backgroundThrottling: false` was 2.8%, the same as visible. So the hidden window kept rendering frames nobody could see. Offscreen, d was 6.9% against 0% for b.

The worst cases are the hidden window doing more renderer work than the visible one (c), and the immersive player's GPU and browser-process cost (d).

## Changes

- `backgroundThrottling: false` removed. Chromium doesn't throttle a page while it plays audio, so playback continues. A hidden window now stops producing frames, and timers are throttled while paused in the background.
- The player store skips `currentTime` updates while `document.hidden` and resyncs on `visibilitychange`, so a hidden window doesn't re-render the chrome four times a second.
- `Waveform.vue` caches peaks and colours, resizes the canvas only when its size changes, and on a progress tick repaints only the bars whose played state changed. Usually that's none. It keeps at most one pending animation frame, where it used to queue one per change and run them all at once when a hidden window came back. It caps the device pixel ratio at 2 and skips painting offscreen instances via `IntersectionObserver`.
- The immersive backdrop blurs the artwork once into a 96 px canvas that CSS scales up, in place of two 90vmax images with `filter: blur(90px)` that the GPU re-blurred on every frame of the drift animation. The drift also stops under `prefers-reduced-motion`.
- The track list's playing indicator animates `transform: scaleY()` instead of `height`, so it no longer runs layout and paint every frame.
- The mock backend keeps blob URLs for the 3 most recent WAVs and revokes the rest. Before, every track played kept 2 to 4 MB alive in the browser process for the whole session.
- `spellcheck: false`. Nothing in the app needs it.

## After

Not measured yet. Re-run `node scripts/measure.mjs --label after` and add the table here. Scenario (f) has no baseline either. The run was stopped before it sampled.
