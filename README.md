# DeadAir — Silence Remover for Premiere Pro

**Automatically detect and remove silent gaps from your Premiere Pro timeline.** Free, open-source, no subscription.

![DeadAir Demo](demo.gif)

---

## Features

- **Adjustable silence threshold** (−60 dB to −10 dB) — fine-tune what counts as silence
- **Auto-detect threshold** — samples up to 3 clips, computes noise floor vs. speech level, suggests the right threshold for your audio
- **Minimum duration control** (0.1 s to 5.0 s) — ignore brief dips, only cut real gaps
- **Smart padding** (0–500 ms) — keeps a buffer around speech so cuts don't clip words
- **Three cut modes:**
  - **Ripple Delete** — cuts out silent segments across all tracks and closes every gap in a single synchronized sweep; audio and video stay perfectly in sync
  - **Disable Clips** — non-destructive; razors and marks silent segments as disabled without deleting anything
  - **Markers Only** — places span markers on the timeline for manual review, no clips touched
- **Track selection** — analyze a specific audio track or all tracks at once
- **Settings persistence** — remembers threshold, duration, padding, and cut mode between sessions
- **In-panel debug console** — real-time log of every operation for easy troubleshooting
- **Works with Premiere Pro 2019+** (v13.0 and later, Windows and macOS)

---

## How It Works

### Audio Analysis (Web Audio API — no plugins needed)

DeadAir reads audio **directly inside the browser panel** using the Web Audio API:

1. For **audio-only clips** (WAV, MP3, AIFF, AAC) under 150 MB — loaded directly via the Node.js `fs` module.
2. For **video clips** (MOV, MP4, MXF, R3D, BRAW, etc.) — FFmpeg extracts audio into an in-memory mono 22 050 Hz WAV pipe; no temp files are written to disk.
3. The raw PCM is decoded with `AudioContext.decodeAudioData()`.
4. Silence is detected by scanning **50 ms windows**, taking the **peak amplitude** in each window, and comparing it to the dB threshold you set.

> FFmpeg is **optional** — it is only required when your clips are video containers. Pure audio projects work with zero dependencies beyond Premiere Pro itself.

### Auto-Detect Threshold

Click **Auto** to let DeadAir suggest a threshold:
- Scans up to the first 3 clips (60 s each)
- Builds a histogram of per-window dB values
- Sets the **5th percentile** as the noise floor and the **70th percentile** as the speech level
- Suggests a threshold at `noise_floor + 30 % × (speech − noise_floor)`, clamped to −55 dB … −15 dB

### Ripple Delete — Two-Phase Approach

Premiere's native per-clip ripple delete shifts positions after every removal, causing audio/video desync when multiple tracks are involved. DeadAir solves this with a two-phase algorithm:

**Phase 1 — Batch remove (no ripple)**
- Uses QE DOM to razor all clips at silence boundaries (all tracks simultaneously)
- Collects object references to every silence clip across all audio and video tracks
- Calls `clip.remove(false, false)` on all of them — this removes clips *without* shifting positions, leaving exact-size gaps in place

**Phase 2 — Single cursor sweep**
- For every track independently, snapshots all remaining clip positions, sorts left-to-right
- Advances a cursor from time 0; whenever a gap > `0.4 / fps` (just under one frame at the sequence's actual frame rate) is detected, moves that clip and all following clips left by the gap amount using `clip.move(delta)`
- Because audio and video clips were removed at the same positions, identical math applied per-track produces identical offsets — **perfect A/V sync with no black frames**

### Disable Mode

- Same QE DOM razor pass to split clips at silence boundaries
- Single forward sweep collecting all clip refs whose midpoint falls inside a silence range
- Batch `clip.disabled = true` — no deletes, fully reversible

### Markers Mode

- Skips the razor entirely
- Creates sequence span markers (`marker.duration` set) named "Silence" for every detected region
- Use **Clear Markers** in the footer to remove them when done

---

## Performance (3-minute talking-head clip, 5 tracks, ~80 silence regions)

| Step | Time |
|------|------|
| Audio analysis | ~2 s |
| Razor (QE DOM) | ~10 s |
| Batch remove + gap sweep | ~8 s |
| Disable mode (batch) | ~8 s |
| Markers only | ~3 s |

---

## Comparison

| Feature | DeadAir | AutoCut | TimeBolt | Manual |
|---------|---------|---------|----------|--------|
| Price | **Free** | $15/mo | $200/yr | Free |
| Open Source | **Yes** | No | No | N/A |
| Auto threshold detect | **Yes** | No | No | N/A |
| Adjustable threshold | Yes | Yes | Yes | N/A |
| Padding control | Yes | Yes | Yes | N/A |
| Ripple delete | Yes | Yes | Yes | Yes |
| Non-destructive mode | **Yes** | No | No | Yes |
| Markers mode | **Yes** | No | No | Yes |
| A/V sync guarantee | **Yes** | Partial | Yes | Yes |
| FFmpeg required | Optional | No | No | No |
| Premiere Pro version | 2019+ | 2020+ | Standalone | Any |

---

## Requirements

- Adobe Premiere Pro 2019 or later (v13.0+)
- Windows 10+ or macOS 10.14+
- [FFmpeg](https://ffmpeg.org/download.html) — **optional**, only needed for video clip files (MOV, MP4, MXF, etc.)

---

## Installation

### Manual Install

1. Download and extract the release ZIP.

2. Copy the `com.deadair.silenceremover` folder to:
   - **Windows:** `%APPDATA%\Adobe\CEP\extensions\`
   - **macOS:** `~/Library/Application Support/Adobe/CEP/extensions/`

3. Enable unsigned extensions in the registry / defaults:
   - **Windows:** `HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.12` → String value `PlayerDebugMode = 1`
   - **macOS:** `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`
   - Repeat for `CSXS.11`, `CSXS.10`, `CSXS.9` if targeting older Premiere versions.

4. *(Video clips only)* Install FFmpeg:
   - **Windows:** `winget install ffmpeg`
   - **macOS:** `brew install ffmpeg`

5. Restart Premiere Pro and open **Window → Extensions → DeadAir - Silence Remover**.

---

## Usage Tips

- **Use Auto first** — click the **Auto** button before analyzing; it calibrates the threshold to your specific recording environment
- **Markers Only before cutting** — preview exactly what will be removed before committing to a ripple delete
- **Preset starting points:**
  - Talking head / interview: threshold −35 dB, min duration 0.8 s, padding 100 ms
  - Podcast: threshold −40 dB, min duration 1.0 s, padding 150 ms
  - Vlog / fast-paced: threshold −30 dB, min duration 0.5 s, padding 50 ms
- **Always save your project** before running Ripple Delete
- Open the **Debug Log** (footer button) if something looks wrong — every clip load, window scan, and ExtendScript call is logged there

---

## Building from Source

No build step required. DeadAir is plain HTML/CSS/JS (frontend) and ExtendScript JSX (backend).

```bash
git clone https://github.com/yourusername/deadair-premiere.git

# Copy to your CEP extensions folder and enable debug mode (see Installation above)
# Edit client/ and host/ files directly — changes take effect on panel reload
```

---

## Contributing

Contributions are welcome!

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push and open a Pull Request

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Extension framework | Adobe CEP 9 (CSXS 9.0) |
| Panel UI | HTML/CSS/JavaScript (vanilla) |
| Audio analysis | Web Audio API (`AudioContext.decodeAudioData`) |
| Audio extraction | FFmpeg (optional, piped to stdout, no temp files) |
| Timeline operations | ExtendScript (ES3) + QE DOM |
| Cut method | `qeSeq.razor(TC)` — auto-discovers working method at runtime |
| Gap closing | `clip.move(delta)` cursor sweep |
| Disable | `clip.disabled = true` batch |
| Markers | `seq.markers.createMarker()` + `marker.duration` (span markers) |
| Settings | `localStorage` |
