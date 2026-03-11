# DeadAir - Silence Remover for Premiere Pro

Scrubbing through dead air by hand is one of those editing tasks that eats 20 minutes a session and feels like it should've been automated years ago. DeadAir is a free Premiere panel that does it for you. No subscription, no account, nothing outside Premiere.

![DeadAir Demo](demo.gif)

Point it at your timeline, set a threshold (or let it figure one out), and it cuts the gaps. Ripple delete, disable, or just drop markers if you want to review first. A/V sync works correctly across multiple tracks, which is where other tools tend to fall apart.

---

## Features

- Adjustable silence threshold (-60 dB to -10 dB)
- Auto-detect threshold: samples up to 3 clips, figures out your noise floor vs. speech level, and picks a starting threshold for you
- Minimum duration control (0.1 s to 5.0 s) so brief dips don't count
- Padding (0-500 ms) to keep a buffer around speech
- Three cut modes: Ripple Delete, Disable Clips, Markers Only
- Analyze a specific audio track or all tracks at once
- Settings persist between sessions
- In-panel debug console so you can see exactly what's happening

Works with Premiere Pro 2019+ (v13.0 and up, Windows and macOS).

---

## How it works

### Audio analysis

DeadAir reads audio directly inside the browser panel using the Web Audio API, no plugins needed:

1. Audio-only clips (WAV, MP3, AIFF, AAC) under 150 MB are loaded directly via the Node.js `fs` module.
2. Video clips (MOV, MP4, MXF, R3D, BRAW, etc.) get their audio extracted by FFmpeg into an in-memory mono 22 050 Hz WAV pipe. No temp files.
3. The raw PCM is decoded with `AudioContext.decodeAudioData()`.
4. Silence detection scans 50 ms windows, takes the peak amplitude in each, and compares it against your threshold.

FFmpeg is optional. Pure audio projects work without it.

### Auto-detect threshold

Click **Auto** and DeadAir will:
- Scan up to the first 3 clips (60 s each)
- Build a histogram of per-window dB values
- Set the 5th percentile as the noise floor and 70th percentile as the speech level
- Suggest a threshold at `noise_floor + 30% x (speech - noise_floor)`, clamped to -55 dB to -15 dB

It's a reasonable starting point. You'll probably still want to adjust it.

### Ripple Delete - why it's a two-phase process

Premiere's built-in ripple delete shifts clip positions after every removal. On a single track that's fine. With multiple tracks it causes A/V desync because each track shifts independently.

DeadAir works around this with two phases:

**Phase 1 - remove without ripple**
- Razors all clips at silence boundaries across all tracks simultaneously (via QE DOM)
- Collects references to every resulting silence clip
- Calls `clip.remove(false, false)` on all of them at once, which removes clips without shifting positions and leaves exact-size gaps

**Phase 2 - cursor sweep**
- For each track, snapshots all remaining clip positions and sorts left-to-right
- Walks a cursor from time 0 and moves clips left whenever it finds a gap larger than `0.4 / fps`
- Because audio and video clips were removed at identical positions, the same math per-track produces identical offsets, so A/V sync is preserved

### Disable mode

- Same QE DOM razor pass to split at silence boundaries
- Collects clip refs where the midpoint falls inside a silence range
- Sets `clip.disabled = true` in a batch, fully reversible

### Markers mode

- Skips the razor entirely
- Creates sequence span markers named "Silence" for every detected region
- Use **Clear Markers** in the footer when you're done reviewing

---

## Performance

Measured on a 3-minute talking-head clip, 5 tracks, ~80 silence regions:

| Step | Time |
|------|------|
| Audio analysis | ~2 s |
| Razor (QE DOM) | ~10 s |
| Batch remove + gap sweep | ~8 s |
| Disable mode | ~8 s |
| Markers only | ~3 s |

---

## Comparison

| Feature | DeadAir | AutoCut | TimeBolt | Manual |
|---------|---------|---------|----------|--------|
| Price | **Free** | $15/mo | $200/yr | Free |
| Open source | **Yes** | No | No | N/A |
| Auto threshold | **Yes** | No | No | N/A |
| Adjustable threshold | Yes | Yes | Yes | N/A |
| Padding control | Yes | Yes | Yes | N/A |
| Ripple delete | Yes | Yes | Yes | Yes |
| Non-destructive mode | **Yes** | No | No | Yes |
| Markers mode | **Yes** | No | No | Yes |
| A/V sync | **Yes** | Partial | Yes | Yes |
| FFmpeg required | Optional | No | No | No |
| Premiere version | 2019+ | 2020+ | Standalone | Any |

---

## Requirements

- Adobe Premiere Pro 2019 or later (v13.0+)
- Windows 10+ or macOS 10.14+
- [FFmpeg](https://ffmpeg.org/download.html) - optional, only needed for video clip files (MOV, MP4, MXF, etc.)

---

## Installation

### Automatic (recommended)

**Windows:** double-click `installer/install-win.bat`

**macOS:** run `bash installer/install-mac.sh` in terminal

The script copies the extension, sets the debug mode registry keys, and checks for FFmpeg.

### Manual

1. Download and extract the release ZIP.

2. Copy the `com.deadair.silenceremover` folder to:
   - Windows: `%APPDATA%\Adobe\CEP\extensions\`
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/`

3. Enable unsigned extensions:
   - Windows: set `HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.12` > `PlayerDebugMode = 1`
   - macOS: `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`
   - Repeat for CSXS.11, CSXS.10, CSXS.9 if you need older Premiere versions.

4. (Video clips only) Install FFmpeg:
   - Windows: `winget install ffmpeg`
   - macOS: `brew install ffmpeg`

5. Restart Premiere Pro, go to Window > Extensions > DeadAir - Silence Remover.

---

## Usage tips

- Run **Auto** before anything else. It takes a few seconds and gets the threshold in the right ballpark.
- Use **Markers Only** first to see what's going to be cut before you commit to a ripple delete.
- Rough presets to start from:
  - Talking head / interview: -35 dB, 0.8 s, 100 ms padding
  - Podcast: -40 dB, 1.0 s, 150 ms padding
  - Vlog / fast-paced: -30 dB, 0.5 s, 50 ms padding
- Save your project before running Ripple Delete.
- If something looks wrong, open the Debug Log from the footer. Every clip load, scan, and ExtendScript call is logged there.

---

## Building from source

No build step. It's plain HTML/CSS/JS and ExtendScript JSX.

```bash
git clone https://github.com/nzalexgarciagil-ctrl/deadair-premiere.git

# Copy to your CEP extensions folder and enable debug mode (see Installation)
# Edit client/ and host/ directly, changes show up on panel reload
```

---

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Commit (`git commit -m 'feat: add my feature'`)
4. Push and open a PR

---

## License

MIT - see [LICENSE](LICENSE).

---

## Technical stack

| Layer | Technology |
|-------|-----------|
| Extension framework | Adobe CEP 9 (CSXS 9.0) |
| Panel UI | HTML/CSS/JavaScript (vanilla) |
| Audio analysis | Web Audio API (`AudioContext.decodeAudioData`) |
| Audio extraction | FFmpeg (optional, piped to stdout, no temp files) |
| Timeline operations | ExtendScript (ES3) + QE DOM |
| Cut method | `qeSeq.razor(TC)`, auto-discovers working method at runtime |
| Gap closing | `clip.move(delta)` cursor sweep |
| Disable | `clip.disabled = true` batch |
| Markers | `seq.markers.createMarker()` + `marker.duration` |
| Settings | `localStorage` |
