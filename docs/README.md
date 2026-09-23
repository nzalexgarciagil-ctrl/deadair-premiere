# Developing DeadAir

DeadAir is a CEP panel with no bundle or build step. Its Node.js tests check shared helpers and mocked host behavior. They do not establish that a Premiere version can load the extension or edit a real sequence correctly.

## Source layout

- `client/` contains the panel markup, styles, shared helpers and controller.
- `host/` contains ExtendScript functions called through `CSInterface.evalScript`.
- `installer/` contains per-user Windows and macOS installers.
- `tests/` contains Node.js regression tests.
- `bin/` documents FFmpeg installation. The current panel searches PATH and common system locations, not this folder.

Use Node.js 20 or later and the pnpm version declared in the root package. Run `pnpm install`, then `pnpm validate`. Reload the installed panel after copying source changes into your test extension directory.

## Analysis flow

Small audio files load through Node's file API. Video and audio files of 150 MB or more use FFmpeg. Extraction reads only the source range used by the clip and returns mono 22,050 Hz WAV data through stdout. It does not create temporary audio files.

The panel decodes the audio with Web Audio and scans 50 ms windows. A window counts as quiet when its peak amplitude is below the selected threshold. Minimum duration filters short regions. Padding reduces the detected region at both edges.

Threshold estimation samples up to the first 60 seconds of three clips. It takes the 5th percentile as the quiet level and the 70th as the louder level, then chooses 30% of the distance between them. The estimate is clamped to -95 through -15 dB. These percentiles do not classify speech.

The current merger takes the union of quiet regions across clips. It is not a multi-track intersection. Do not describe all-track analysis as “all tracks must be quiet”.

## Review and host calls

The panel displays the active sequence, audio source, detected regions and edit scope before exposing a timeline action. Region previews move the playhead using `Sequence.setPlayerPosition` with a ticks string. Preview and apply compare the active sequence's `sequenceID` with the analyzed sequence before proceeding.

Detection changes discard old results. There is no live timeline-content fingerprint. Users must analyze again after editing clips, including edits made within the same sequence.

Marker review is the default for every analysis. Clip-editing actions require acknowledgement of the affected tracks and a saved sequence copy. This acknowledgement is not a backup operation.

## Timeline-editing limits

The removal engine uses Premiere's undocumented QE API to find a working razor method, splits at region boundaries, then gathers clips whose midpoint lies inside a region. Disable and removal sweep all video and audio tracks. The analysis track argument does not restrict that sweep.

Leave gaps stops after non-ripple removal. Close gaps packs the remaining clips independently on each track, starting from zero. That also closes pre-existing gaps and can shift tracks by different amounts. The guided-review changes do not fix this algorithm.

Some host operations catch individual failures. A returned count is not proof that every requested edit succeeded. Test actual Premiere behavior on duplicate sequences before making stronger claims about sync, undo, codecs or version support.

## Test coverage

Run `pnpm validate` before submitting changes. The suite includes threshold and formatting helpers, marker-first panel behavior, sequence-bound previews and action routing, plus the existing mocked leave-gaps regression.

Before a release, also check a real Premiere panel on supported Windows and macOS versions. Test narrow docking, keyboard navigation, skipped media, saved settings and all four actions. Include staggered audio/video tracks and intentional gaps in edit tests. Do not run destructive test actions on production sequences.

## Packaging

Pushing a version tag starts the release workflow. It packages an explicitly selected set of extension files inside `com.deadair.silenceremover/`. Scratch files, dependencies, tests and repository metadata are excluded.

The release instructions must match the README: FFmpeg is required for video and large audio files, not for every audio-only workflow. Do not publish a release until host verification and the versioned changelog have been reviewed.
