# FFmpeg

DeadAir uses FFmpeg to extract audio from video files and audio files of 150 MB or more. Silence detection runs in the panel after extraction. Smaller audio files can load directly when their codec is supported.

Install an FFmpeg build for Windows or macOS from the [official download page](https://ffmpeg.org/download.html), then make the executable available on your PATH. On macOS with Homebrew, run `brew install ffmpeg`.

Restart Premiere after installation. The panel also checks common system installation paths. Placing a binary in this folder alone does not make it discoverable by the current panel.

Do not commit downloaded binaries. See the [installation guide](../README.md#install) for the extension setup.
