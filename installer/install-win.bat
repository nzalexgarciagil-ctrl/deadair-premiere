@echo off
REM DeadAir - Silence Remover for Premiere Pro
REM Windows Installation Script

echo.
echo  ====================================
echo   DeadAir - Silence Remover Installer
echo  ====================================
echo.

set "EXT_DIR=%APPDATA%\Adobe\CEP\extensions\com.deadair.silenceremover"

REM Check if already installed
if exist "%EXT_DIR%" (
    echo [!] Previous installation found. Removing...
    rmdir /s /q "%EXT_DIR%"
)

REM Copy extension files
echo [1/3] Installing extension files...
xcopy /s /e /i /q "%~dp0.." "%EXT_DIR%" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Failed to copy extension files.
    echo         Try running as Administrator.
    pause
    exit /b 1
)

REM Enable unsigned extensions (CEP debug mode)
echo [2/3] Enabling unsigned extensions...
reg add "HKCU\SOFTWARE\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\SOFTWARE\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\SOFTWARE\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\SOFTWARE\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1

REM Check for FFmpeg
echo [3/3] Checking for FFmpeg...
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo.
    echo [!] FFmpeg not found in PATH.
    echo     DeadAir requires FFmpeg for audio analysis.
    echo.
    echo     Options:
    echo     1. Download from https://ffmpeg.org/download.html
    echo     2. Install via: winget install ffmpeg
    echo     3. Place ffmpeg.exe in the extension's bin\ folder
    echo.
) else (
    echo     FFmpeg found.
)

echo.
echo  ====================================
echo   Installation complete!
echo  ====================================
echo.
echo  Restart Premiere Pro, then go to:
echo  Window ^> Extensions ^> DeadAir - Silence Remover
echo.
pause
