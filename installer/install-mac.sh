#!/bin/bash
# DeadAir - Silence Remover for Premiere Pro
# macOS Installation Script

echo ""
echo "  ===================================="
echo "   DeadAir - Silence Remover Installer"
echo "  ===================================="
echo ""

EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/com.deadair.silenceremover"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

# Check if already installed
if [ -d "$EXT_DIR" ]; then
    echo "[!] Previous installation found. Removing..."
    rm -rf "$EXT_DIR"
fi

# Copy extension files
echo "[1/3] Installing extension files..."
mkdir -p "$EXT_DIR"
cp -R "$SOURCE_DIR"/* "$EXT_DIR/" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to copy extension files."
    exit 1
fi

# Enable unsigned extensions
echo "[2/3] Enabling unsigned extensions..."
defaults write com.adobe.CSXS.12 PlayerDebugMode 1 2>/dev/null
defaults write com.adobe.CSXS.11 PlayerDebugMode 1 2>/dev/null
defaults write com.adobe.CSXS.10 PlayerDebugMode 1 2>/dev/null
defaults write com.adobe.CSXS.9 PlayerDebugMode 1 2>/dev/null

# Check for FFmpeg
echo "[3/3] Checking for FFmpeg..."
if ! command -v ffmpeg &>/dev/null; then
    echo ""
    echo "[!] FFmpeg not found."
    echo "    DeadAir requires FFmpeg for audio analysis."
    echo ""
    echo "    Install via Homebrew:"
    echo "    brew install ffmpeg"
    echo ""
else
    echo "    FFmpeg found: $(which ffmpeg)"
fi

echo ""
echo "  ===================================="
echo "   Installation complete!"
echo "  ===================================="
echo ""
echo "  Restart Premiere Pro, then go to:"
echo "  Window > Extensions > DeadAir - Silence Remover"
echo ""
