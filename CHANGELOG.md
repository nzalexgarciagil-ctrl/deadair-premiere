# Changelog

All notable changes to DeadAir will be documented in this file.

## [1.2.0] - 2026-09-02

### Added
- Silence thresholds from -100 dB to -10 dB with exact numeric entry
- Auto-detection support for noise floors below -60 dB
- Leave Gaps action that removes silent sections without shifting later clips
- Clear action descriptions and action-specific confirmation text
- Automated tests for threshold calculations and timeline action routing
- Source validation through GitHub Actions

### Changed
- Reworked timeline-action controls for faster mode selection and clearer consequences
- Positioned DeadAir as an amplitude-based complement to Premiere's transcript-based pause removal

### Fixed
- Exposed shared panel helpers correctly when CEP provides CommonJS globals
- Replaced CEP-incompatible asynchronous file and FFmpeg callbacks with bounded operations
- Limited FFmpeg extraction to the source range used by each timeline clip

## [1.0.0] - 2026-03-10

### Added
- Audio silence detection using FFmpeg silencedetect filter
- Adjustable silence threshold (-60dB to -20dB)
- Adjustable minimum silence duration (0.3s to 5.0s)
- Configurable padding (0ms to 500ms) for natural cuts
- Three cut modes: Ripple Delete, Disable Clips, Markers Only
- Track selection (individual or all audio tracks)
- Multi-track intersection analysis (silence must exist on ALL selected tracks)
- Settings persistence between sessions
- Single-step undo support (Ctrl+Z)
- Progress indication during analysis
- Preview results before executing
- Clear markers utility
- Windows and macOS installers
- Premiere Pro 2019+ compatibility (CEP)
