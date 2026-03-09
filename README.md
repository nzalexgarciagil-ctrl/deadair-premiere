# DeadAir - Free Silence Remover for Premiere Pro

**Automatically detect and remove silent gaps from your Premiere Pro timeline.** Free, open-source, no subscription.

<!-- TODO: Add demo GIF here -->
<!-- ![DeadAir Demo](demo.gif) -->

---

## Features

- **Adjustable silence threshold** (-60dB to -20dB) - fine-tune what counts as "silence"
- **Minimum duration control** (0.3s to 5.0s) - preserve natural breathing pauses
- **Smart padding** (0-500ms) - prevents jarring cuts by keeping a buffer around speech
- **Three cut modes:**
  - **Ripple Delete** - removes silence and closes gaps automatically
  - **Disable Clips** - non-destructive, marks silent segments as disabled
  - **Markers Only** - places markers for manual review
- **Track selection** - analyze specific audio tracks or all at once
- **Single Ctrl+Z undo** - revert everything in one step
- **Settings persistence** - remembers your preferences between sessions
- **Works with Premiere Pro 2019+** (v13.0 and later)

## How It Works

1. Select your analysis settings (threshold, duration, padding)
2. Click **Analyze Silence** - DeadAir uses FFmpeg to scan your clips' audio
3. Review the results (number of silent regions found, total duration)
4. Click **Remove Silence** to apply your chosen cut mode

DeadAir uses FFmpeg's `silencedetect` audio filter for accurate, reliable detection. Cuts are processed from the end of the timeline backwards to maintain correct timecodes.

## Comparison

| Feature | DeadAir | AutoCut | TimeBolt | Manual |
|---------|---------|---------|----------|--------|
| Price | **Free** | $15/mo | $200/yr | Free |
| Open Source | Yes | No | No | N/A |
| Adjustable Threshold | Yes | Yes | Yes | N/A |
| Padding Control | Yes | Yes | Yes | N/A |
| Ripple Delete | Yes | Yes | Yes | Yes |
| Non-destructive Mode | Yes | No | No | Yes |
| Markers Mode | Yes | No | No | Yes |
| Undo Support | Yes | Partial | Partial | Yes |
| Premiere Pro Version | 2019+ | 2020+ | Standalone | Any |

## Requirements

- Adobe Premiere Pro 2019 or later (v13.0+)
- [FFmpeg](https://ffmpeg.org/download.html) installed and accessible
- Windows 10+ or macOS 10.14+

## Installation

### Quick Install

**Windows:**
1. Download the [latest release](../../releases/latest)
2. Extract the ZIP
3. Run `installer\install-win.bat`
4. Restart Premiere Pro

**macOS:**
1. Download the [latest release](../../releases/latest)
2. Extract the ZIP
3. Run `installer/install-mac.sh`
4. Restart Premiere Pro

### Manual Install

1. Download and extract the release ZIP

2. Copy the extension folder to:
   - **Windows:** `%APPDATA%\Adobe\CEP\extensions\com.deadair.silenceremover\`
   - **macOS:** `~/Library/Application Support/Adobe/CEP/extensions/com.deadair.silenceremover/`

3. Enable unsigned extensions:
   - **Windows:** Open Registry Editor, navigate to `HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.12`, create a String value `PlayerDebugMode` set to `1`
   - **macOS:** Run `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`
   - (Repeat for CSXS.11, .10, .9 if targeting older Premiere versions)

4. Install FFmpeg if not already installed:
   - **Windows:** `winget install ffmpeg`
   - **macOS:** `brew install ffmpeg`

5. Restart Premiere Pro

6. Go to **Window > Extensions > DeadAir - Silence Remover**

## Usage Tips

- Start with the default settings and adjust from there
- For **dialogue/talking head** content: threshold -35dB, duration 0.8s, padding 100ms
- For **podcast** content: threshold -40dB, duration 1.0s, padding 150ms
- For **vlog/fast-paced** content: threshold -30dB, duration 0.5s, padding 50ms
- Use **Markers Only** mode first to preview what will be cut
- Always save your project before running Ripple Delete

## Building from Source

```bash
git clone https://github.com/yourusername/deadair-premiere.git
cd deadair-premiere

# No build step required - it's plain HTML/CSS/JS + ExtendScript
# Just copy to your CEP extensions folder and enable debug mode
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [FFmpeg](https://ffmpeg.org/) for audio analysis
- [Adobe CEP](https://github.com/nicholasWijworN/cep-lib/tree/master) for the extension framework
- The editing community for inspiration and feedback
