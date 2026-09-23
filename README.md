# DeadAir for Premiere Pro

DeadAir finds quiet sections in your audio and lets you remove, disable or mark them in Premiere Pro. It is free and open source. No account or subscription is needed.

Detection uses audio levels, not a transcript. Use it when you need a specific dB threshold or want to analyze one audio track. For spoken pauses detected from a transcript, Premiere's built-in Text-Based Editing may be a better fit.

**Start with markers on a duplicate sequence.** Clip-editing actions affect all video and audio tracks. Close gaps also removes existing gaps, which can change intended timing and A/V sync.

## Install

The extension targets Premiere Pro 2019 and later on Windows and macOS through Adobe CEP. That version range is not a tested compatibility guarantee. Timeline editing uses Premiere's undocumented QE API, so behavior can vary by version.

1. From this repository's **Code** menu, choose **Download ZIP**, then extract it. You do not need a published release to install.
2. Close Premiere and run the installer from the extracted folder:
   - **Windows:** double-click `installer/install-win.bat`.
   - **macOS:** open Terminal in the extracted folder and run `bash installer/install-mac.sh`.
3. Restart Premiere. Open **Window > Extensions > DeadAir - Silence Remover**.

The installers replace an existing DeadAir installation and enable unsigned CEP extensions for the current user. Review the scripts before running them. They do not install FFmpeg or change your project.

### When you need FFmpeg

Video files and audio files of 150 MB or more need [FFmpeg](https://ffmpeg.org/download.html). Smaller audio files can load directly when Premiere's panel supports their codec.

- **Windows:** install FFmpeg and put the folder containing `ffmpeg.exe` on your PATH.
- **macOS:** run `brew install ffmpeg` if you use Homebrew.

Restart Premiere after installing FFmpeg. Some codecs may still be unsupported. Check **Help and troubleshooting** in the panel if a clip is skipped.

### Manual installation

Create a folder named `com.deadair.silenceremover` in your CEP extensions directory:

- **Windows:** `%APPDATA%\Adobe\CEP\extensions\`
- **macOS:** `~/Library/Application Support/Adobe/CEP/extensions/`

Copy the extracted extension files into that folder. The `CSXS`, `client`, `host` and `bin` folders must sit directly inside it, not inside another extracted folder.

Enable unsigned extensions for your CEP runtime. The installers set `PlayerDebugMode` to `1` for CSXS versions 9 through 13. For CSXS 13, set the Windows string value at `HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.13`, or run `defaults write com.adobe.CSXS.13 PlayerDebugMode 1` on macOS. Older runtimes need the matching version number.

Restart Premiere and open the extension. If it does not appear, check the folder structure and the debug-mode setting for your Premiere version.

## First run

1. Duplicate your sequence and open the copy. Choose **Refresh** in DeadAir to see the active sequence.
2. Under **Analyze audio from**, choose the track with your dialogue. This selects the audio used for detection, not the tracks that an edit will affect.
3. Choose **Estimate threshold**, or enter a threshold yourself. Adjust **Minimum quiet time** and **Keep around speech** if needed.
4. Choose **Find quiet sections**. The panel shows detected regions and their total duration.
5. Select a region and choose **Show in timeline**. Play the sequence in Premiere to listen. The highlighted overview shows region positions, not an audio waveform.
6. Leave **Markers only** selected and choose **Add silence markers**. Your clips stay unchanged.

Each analysis starts in marker mode. To edit clips, review the affected tracks, choose another action and confirm that you saved a sequence copy. Changing detection settings clears the results. If you edit the timeline, analyze again before applying an action.

## Detection settings

- **Silence threshold:** audio below this level counts as quiet. The range is -100 to -10 dB. A higher value detects more audio as quiet.
- **Estimate threshold:** samples up to three clips and suggests a starting value. It does not know which audio you want to keep.
- **Minimum quiet time:** ignores quiet sections shorter than the selected duration, from 0.1 to 5 seconds.
- **Keep around speech:** retains 0 to 500 ms at each edge of a detected quiet section. This is the padding around speech.

The default settings are -35 dB, 0.8 seconds and 100 ms. Review the result rather than treating these as a preset for every recording.

## Timeline actions

- **Markers only:** adds sequence markers named “Silence”. No clips change.
- **Disable sections:** splits clips and disables the quiet pieces. Their positions stay unchanged.
- **Remove and leave gaps:** deletes quiet pieces without moving later clips.
- **Remove and close gaps:** deletes quiet pieces, then closes gaps on each track, including gaps that existed before analysis.

Detection settings persist between sessions. A clip-editing action is not remembered as the default.

## Limitations to check before editing

- **All audio tracks combines quiet regions from any selected track.** It does not require every track to be quiet at the same time. Another track may contain speech during a detected region. Prefer a single reference track and review the result.
- **Clip edits affect all video and audio tracks.** Selecting one analysis track does not isolate edits to that track.
- **Close gaps can change A/V sync on tracks with different layouts.** Do not use it on a sequence with deliberate offsets or gaps unless you are working on a copy and can inspect every change.
- **Existing results do not track timeline edits.** Refresh or analyze again after changing clips. Switching to a different sequence blocks preview and apply until you analyze that sequence.
- **Clear markers removes every marker named “Silence”.** That includes markers created outside DeadAir. The panel asks before removing them.
- **A skipped clip means incomplete analysis.** Check the warning and debug log before editing. Large-file extraction can block the panel until the current clip finishes.

Undo behavior and clip-editing results need checking in your Premiere version. Keep a sequence copy rather than relying on a single undo step.

## Troubleshooting

Open **Help and troubleshooting** in the panel. Check that the source media is online and FFmpeg is available when needed. The debug log records file loads and Premiere calls. It includes local file paths, so review the contents before sharing it.

If you report a problem, include your OS, Premiere version, file format, selected action and steps to reproduce it. State whether the problem happens with markers only or only when editing clips.

## Develop and contribute

The panel uses plain HTML, CSS and JavaScript with an ExtendScript backend. There is no build step. Validation uses Node.js 20 or later and pnpm.

```bash
git clone https://github.com/Alx8g/deadair-premiere.git
cd deadair-premiere
pnpm install
pnpm validate
```

Read the [developer guide](docs/README.md) for the analysis flow, test boundaries and release packaging. Make changes on a branch and open a pull request with the behavior changed and the checks you ran. Do not describe mocked tests as proof of Premiere compatibility.

## License

[MIT](LICENSE).
