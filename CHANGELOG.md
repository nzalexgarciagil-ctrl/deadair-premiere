# Changelog

All notable changes to DeadAir will be documented in this file.

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
