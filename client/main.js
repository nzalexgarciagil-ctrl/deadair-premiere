/**
 * DeadAir - Silence Remover for Adobe Premiere Pro
 * Frontend controller — Web Audio API analysis, no FFmpeg required.
 */

(function () {
    "use strict";

    var cs = new CSInterface();
    var analysisResults = null;
    var lastLoadedClips = null;

    // ============================================================
    // IN-PANEL DEBUG CONSOLE
    // ============================================================

    var _logEl = null;
    var _earlyLogs = [];

    function dbg(type, msg) {
        var line = "[" + type.toUpperCase() + "] " + msg;
        if (_logEl) {
            var div = document.createElement("div");
            div.className = "log-line log-" + type;
            div.textContent = line;
            _logEl.appendChild(div);
            _logEl.scrollTop = _logEl.scrollHeight;
        } else {
            _earlyLogs.push({ type: type, msg: line });
        }
    }

    // Intercept native console so everything flows into the panel
    var _origLog   = console.log.bind(console);
    var _origWarn  = console.warn.bind(console);
    var _origError = console.error.bind(console);

    console.log   = function () { var m = Array.prototype.join.call(arguments, " "); _origLog(m);   dbg("info",  m); };
    console.warn  = function () { var m = Array.prototype.join.call(arguments, " "); _origWarn(m);  dbg("warn",  m); };
    console.error = function () { var m = Array.prototype.join.call(arguments, " "); _origError(m); dbg("error", m); };

    function initDebugPanel() {
        _logEl = document.getElementById("debug-log");

        // Flush early logs
        for (var i = 0; i < _earlyLogs.length; i++) {
            var e = _earlyLogs[i];
            var div = document.createElement("div");
            div.className = "log-line log-" + e.type;
            div.textContent = e.msg;
            _logEl.appendChild(div);
        }
        _earlyLogs = [];

        document.getElementById("btn-toggle-log").addEventListener("click", function () {
            var panel = document.getElementById("debug-panel");
            panel.classList.toggle("hidden");
        });

        document.getElementById("btn-clear-log").addEventListener("click", function () {
            _logEl.innerHTML = "";
        });

        document.getElementById("btn-copy-log").addEventListener("click", function () {
            var lines = _logEl.querySelectorAll(".log-line");
            var text = Array.prototype.map.call(lines, function (l) { return l.textContent; }).join("\n");
            if (!text) { return; }
            navigator.clipboard.writeText(text).then(function () {
                var btn = document.getElementById("btn-copy-log");
                btn.textContent = "Copied!";
                setTimeout(function () { btn.textContent = "Copy"; }, 1500);
            }).catch(function () {
                // Fallback for older CEP
                var ta = document.createElement("textarea");
                ta.value = text;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.select();
                document.execCommand("copy");
                document.body.removeChild(ta);
                var btn = document.getElementById("btn-copy-log");
                btn.textContent = "Copied!";
                setTimeout(function () { btn.textContent = "Copy"; }, 1500);
            });
        });

        // Log system info immediately
        console.log("DeadAir v1.0.1 ready");
        console.log("Platform: " + navigator.platform);
        console.log("AudioContext: " + (typeof AudioContext !== "undefined" ? "yes" : typeof webkitAudioContext !== "undefined" ? "webkit" : "MISSING"));
        console.log("XHR: " + (typeof XMLHttpRequest !== "undefined" ? "yes" : "MISSING"));
    }

    // ============================================================
    // DOM REFERENCES
    // ============================================================

    var dom = {
        statusBar:        document.getElementById("status-bar"),
        statusText:       document.getElementById("status-text"),
        threshold:        document.getElementById("threshold"),
        thresholdValue:   document.getElementById("threshold-value"),
        minDuration:      document.getElementById("min-duration"),
        durationValue:    document.getElementById("duration-value"),
        padding:          document.getElementById("padding"),
        paddingValue:     document.getElementById("padding-value"),
        trackSelect:      document.getElementById("track-select"),
        btnAnalyze:       document.getElementById("btn-analyze"),
        btnAuto:          document.getElementById("btn-auto"),
        btnExecute:       document.getElementById("btn-execute"),
        btnCancel:        document.getElementById("btn-cancel"),
        btnClearMarkers:  document.getElementById("btn-clear-markers"),
        confirmActions:   document.getElementById("confirm-actions"),
        progressContainer: document.getElementById("progress-container"),
        progressFill:     document.getElementById("progress-fill"),
        progressText:     document.getElementById("progress-text"),
        results:          document.getElementById("results"),
        regionCount:      document.getElementById("region-count"),
        totalSilence:     document.getElementById("total-silence"),
        noiseHint:        document.getElementById("noise-hint"),
        noiseFloorLabel:  document.getElementById("noise-floor-label"),
        speechLevelLabel: document.getElementById("speech-level-label")
    };

    // ============================================================
    // INIT
    // ============================================================

    function init() {
        initDebugPanel();
        bindSliders();
        bindButtons();
        loadSettings();
        setTimeout(refreshTrackList, 600);
    }

    // ============================================================
    // SLIDERS
    // ============================================================

    function bindSliders() {
        dom.threshold.addEventListener("input", function () {
            dom.thresholdValue.textContent = this.value + " dB";
            saveSettings();
        });
        dom.minDuration.addEventListener("input", function () {
            dom.durationValue.textContent = parseFloat(this.value).toFixed(1) + "s";
            saveSettings();
        });
        dom.padding.addEventListener("input", function () {
            dom.paddingValue.textContent = this.value + "ms";
            saveSettings();
        });
    }

    // ============================================================
    // BUTTONS
    // ============================================================

    function bindButtons() {
        dom.btnAnalyze.addEventListener("click", startAnalysis);
        dom.btnAuto.addEventListener("click", runAutoDetect);
        dom.btnExecute.addEventListener("click", executeRemoval);
        dom.btnCancel.addEventListener("click", cancelAnalysis);
        dom.btnClearMarkers.addEventListener("click", clearMarkers);
    }

    // ============================================================
    // TRACK LIST
    // ============================================================

    var seqSettings = null; // populated by refreshTrackList, used throughout

    function refreshTrackList() {
        console.log("Fetching sequence info...");
        evalScript("getSequenceInfo()", function (resp) {
            var r = parseResp(resp);
            if (!r || !r.success) {
                console.warn("No active sequence or evalScript error: " + resp);
                showStatus("Open a sequence to begin.", "info");
                return;
            }

            seqSettings = r.data;

            var fpsStr  = seqSettings.fps ? seqSettings.fps.toFixed(2) + " fps" : "? fps";
            var sizeStr = (seqSettings.width && seqSettings.height)
                ? seqSettings.width + "x" + seqSettings.height
                : "?x?";
            var durStr  = seqSettings.durationSecs
                ? (seqSettings.durationSecs / 60).toFixed(1) + " min"
                : "";

            console.log("Sequence: " + seqSettings.name
                + " | " + fpsStr
                + " | " + sizeStr
                + (durStr ? " | " + durStr : "")
                + " | Audio tracks: " + seqSettings.audioTracks.length);

            for (var i = 0; i < seqSettings.audioTracks.length; i++) {
                var t = seqSettings.audioTracks[i];
                console.log("  Track " + t.index + ": " + t.name + " (" + t.clipCount + " clips)");
            }

            hideStatus();
            var sel = dom.trackSelect;
            while (sel.options.length > 1) sel.remove(1);
            for (var i = 0; i < seqSettings.audioTracks.length; i++) {
                var t = seqSettings.audioTracks[i];
                var opt = document.createElement("option");
                opt.value = String(t.index);
                opt.textContent = t.name + " (" + t.clipCount + " clips)";
                sel.appendChild(opt);
            }
            lastLoadedClips = null;
        });
    }

    // ============================================================
    // LOAD CLIPS FROM EXTENDSCRIPT
    // ============================================================

    function getClips(callback) {
        if (lastLoadedClips) { callback(null, lastLoadedClips); return; }

        var trackIndices = getSelectedTrackIndices();
        console.log("Getting clips for tracks: " + JSON.stringify(trackIndices));

        evalScript('getClipMediaPaths(' + JSON.stringify(JSON.stringify(trackIndices)) + ')', function (resp) {
            var r = parseResp(resp);
            if (!r || !r.success) {
                console.error("getClipMediaPaths failed: " + resp);
                callback("Failed to get clip info: " + (r ? r.error : "ExtendScript error")); return;
            }
            console.log("Total clips returned: " + r.data.length);
            for (var i = 0; i < r.data.length; i++) {
                var c = r.data[i];
                console.log("  [" + i + "] " + c.name + " | path=" + (c.mediaPath || "(none)") + " | in=" + c.inPointSeconds.toFixed(2) + " out=" + c.outPointSeconds.toFixed(2));
            }
            var clips = r.data.filter(function (c) { return c.mediaPath && c.mediaPath.length > 0; });
            if (clips.length === 0) {
                console.error("No clips with media paths. All " + r.data.length + " clips have empty paths.");
                callback("No clips with media found. Clips may be offline or video-only."); return;
            }
            lastLoadedClips = clips;
            callback(null, clips);
        });
    }

    // ============================================================
    // AUTO-DETECT THRESHOLD
    // ============================================================

    function runAutoDetect() {
        dom.btnAuto.disabled = true;
        dom.btnAnalyze.disabled = true;
        dom.noiseHint.classList.add("hidden");
        showProgress("Loading clips for auto-detect...", 5);

        getClips(function (err, clips) {
            if (err) {
                showStatus(err, "error");
                hideProgress();
                dom.btnAuto.disabled = false;
                dom.btnAnalyze.disabled = false;
                return;
            }

            showProgress("Scanning audio levels...", 15);

            // Collect amplitude samples from all clips (up to first 60s per clip, max 3 clips)
            var sampleClips = clips.slice(0, 3);
            var allWindowDb = [];
            var idx = 0;
            var loadFails = 0;

            function scanNext() {
                if (idx >= sampleClips.length) {
                    finishAutoDetect(allWindowDb, loadFails, clips.length);
                    return;
                }
                var clip = sampleClips[idx++];
                var pct = 15 + Math.round((idx / sampleClips.length) * 75);
                showProgress("Scanning clip " + idx + " of " + sampleClips.length + "...", pct);

                loadAudioBuffer(clip, function (err, buffer, usedClip) {
                    if (err || !buffer) {
                        loadFails++;
                        scanNext();
                        return;
                    }
                    var dbValues = collectWindowDb(buffer, usedClip);
                    for (var i = 0; i < dbValues.length; i++) allWindowDb.push(dbValues[i]);
                    scanNext();
                });
            }

            scanNext();
        });
    }

    /**
     * Collect dB values for each 50ms window across the clip's in-point range.
     * Capped at 60 seconds of analysis to keep it fast.
     */
    function collectWindowDb(buffer, clip) {
        var sampleRate = buffer.sampleRate;
        var numChannels = buffer.numberOfChannels;
        var windowSize = Math.max(1, Math.floor(sampleRate * 0.05)); // 50ms
        var startSample = Math.floor(clip.inPointSeconds * sampleRate);
        var maxAnalyze = Math.floor(60 * sampleRate); // max 60s
        var endSample = Math.min(
            Math.floor(clip.outPointSeconds * sampleRate),
            startSample + maxAnalyze,
            buffer.length
        );

        var channels = [];
        for (var c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

        var dbValues = [];
        for (var i = startSample; i < endSample; i += windowSize) {
            var maxAmp = 0;
            var wEnd = Math.min(i + windowSize, endSample);
            for (var j = i; j < wEnd; j++) {
                for (var c = 0; c < channels.length; c++) {
                    var v = Math.abs(channels[c][j]);
                    if (v > maxAmp) maxAmp = v;
                }
            }
            // Convert to dB, floor at -80
            var db = maxAmp > 0 ? 20 * Math.log10(maxAmp) : -80;
            if (db < -80) db = -80;
            dbValues.push(db);
        }
        return dbValues;
    }

    /**
     * Use the collected dB histogram to estimate a smart threshold.
     * Algorithm:
     *   1. Sort all values
     *   2. Find the noise floor (5th percentile = mostly quiet)
     *   3. Find the speech level (70th percentile = typical vocal content)
     *   4. Threshold = noise_floor + 30% of the gap toward speech
     *   5. Clamp to -55dB .. -15dB
     */
    function finishAutoDetect(allDb, loadFails, totalClips) {
        hideProgress();
        dom.btnAuto.disabled = false;
        dom.btnAnalyze.disabled = false;

        if (allDb.length === 0) {
            showStatus("Auto-detect failed — could not load audio. Check console for details.", "error");
            return;
        }

        allDb.sort(function (a, b) { return a - b; });

        var noiseFloor  = allDb[Math.floor(allDb.length * 0.05)];  // 5th pct
        var speechLevel = allDb[Math.floor(allDb.length * 0.70)];  // 70th pct
        var gap = speechLevel - noiseFloor;

        // Threshold sits 30% up from the noise floor toward speech
        var suggestedDb = noiseFloor + gap * 0.30;
        suggestedDb = Math.max(-55, Math.min(-15, suggestedDb));
        var rounded = Math.round(suggestedDb);

        // Update slider
        dom.threshold.value = rounded;
        dom.thresholdValue.textContent = rounded + " dB";
        saveSettings();

        // Show hint labels
        dom.noiseFloorLabel.textContent  = "Floor: " + Math.round(noiseFloor) + "dB";
        dom.speechLevelLabel.textContent = "Speech: " + Math.round(speechLevel) + "dB";
        dom.noiseHint.classList.remove("hidden");

        var msg = "Auto-set to " + rounded + " dB";
        if (loadFails > 0) msg += " (" + loadFails + " of " + totalClips + " clips skipped — codec unsupported)";
        showStatus(msg, "success");
    }

    // ============================================================
    // MAIN ANALYSIS
    // ============================================================

    function startAnalysis() {
        analysisResults = null;
        hideResults();
        dom.btnAnalyze.disabled = true;
        dom.btnAuto.disabled = true;
        dom.confirmActions.classList.add("hidden");
        lastLoadedClips = null; // force fresh clip list

        showProgress("Getting clip info...", 5);

        getClips(function (err, clips) {
            if (err) {
                showStatus(err, "error");
                hideProgress();
                dom.btnAnalyze.disabled = false;
                dom.btnAuto.disabled = false;
                return;
            }
            analyzeClips(clips);
        });
    }

    function analyzeClips(clips) {
        var thresholdLinear = Math.pow(10, parseFloat(dom.threshold.value) / 20);
        var minDuration     = parseFloat(dom.minDuration.value);
        var paddingSec      = parseInt(dom.padding.value) / 1000;

        var allRegions = [];
        var loadFails  = 0;
        var idx = 0;

        function processNext() {
            if (idx >= clips.length) {
                finishAnalysis(allRegions, loadFails, clips.length);
                return;
            }
            var clip = clips[idx++];
            var pct = 5 + Math.round((idx / clips.length) * 88);
            showProgress("Analyzing clip " + idx + " / " + clips.length + " — " + clip.name, pct);

            loadAudioBuffer(clip, function (err, buffer, usedClip) {
                if (err || !buffer) {
                    console.warn("[DeadAir] Skipping clip:", clip.name, err || "no buffer");
                    loadFails++;
                    processNext();
                    return;
                }
                var regions = findSilentRegions(buffer, usedClip, thresholdLinear, minDuration, paddingSec);
                for (var i = 0; i < regions.length; i++) allRegions.push(regions[i]);
                processNext();
            });
        }

        processNext();
    }

    // ============================================================
    // LOAD AUDIO BUFFER
    // Strategy: Node.js fs (small files) → FFmpeg (video/large) → XHR fallback
    // ============================================================

    var _nodeRequire = null;
    function getNodeRequire() {
        if (_nodeRequire) return _nodeRequire;
        try {
            if (typeof cep_node !== "undefined" && cep_node && typeof cep_node.require === "function") {
                _nodeRequire = cep_node.require;
                console.log("Node.js: cep_node.require available");
            } else if (typeof require === "function") {
                _nodeRequire = require;
                console.log("Node.js: global require available");
            } else {
                console.warn("Node.js: NOT available — large video files may fail");
            }
        } catch (e) {
            console.warn("Node.js detection error: " + e.message);
        }
        return _nodeRequire;
    }

    function loadAudioBuffer(clip, callback) {
        var rawPath = clip.mediaPath;
        console.log("Loading: " + clip.name);
        console.log("  Path: " + rawPath);
        console.log("  In=" + clip.inPointSeconds.toFixed(2) + "s Out=" + clip.outPointSeconds.toFixed(2) + "s");

        var nr = getNodeRequire();
        if (nr) {
            loadViaNode(rawPath, clip, nr, callback);
        } else {
            loadViaXHR(rawPath, clip, callback);
        }
    }

    function loadViaNode(rawPath, clip, nr, callback) {
        try {
            var fs = nr("fs");
            var stat;
            try { stat = fs.statSync(rawPath); } catch (e) {
                console.error("  fs.statSync failed: " + e.message);
                callback("File not found or inaccessible: " + rawPath);
                return;
            }

            var sizeMB = stat.size / 1024 / 1024;
            console.log("  File size: " + sizeMB.toFixed(1) + "MB");

            var isVideoExt = /\.(mov|mp4|mxf|avi|mts|m2ts|r3d|braw|arw|dng)$/i.test(rawPath);

            if (!isVideoExt && sizeMB < 150) {
                // Small audio file — read directly
                console.log("  Strategy: fs.readFile (audio, small)");
                fs.readFile(rawPath, function (err, data) {
                    if (err) {
                        console.warn("  fs.readFile failed: " + err.message + " — trying FFmpeg");
                        tryFFmpeg(rawPath, clip, nr, callback);
                        return;
                    }
                    // Node Buffer → ArrayBuffer
                    var ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                    decodeArrayBuffer(ab, clip, callback);
                });
            } else {
                // Video or large file — extract audio via FFmpeg
                console.log("  Strategy: FFmpeg audio extraction (video/large file)");
                tryFFmpeg(rawPath, clip, nr, callback);
            }
        } catch (e) {
            console.error("  loadViaNode exception: " + e.message);
            loadViaXHR(rawPath, clip, callback);
        }
    }

    function tryFFmpeg(rawPath, clip, nr, callback) {
        findFFmpeg(nr, function (ffmpegPath) {
            if (!ffmpegPath) {
                console.error("  FFmpeg not found. Install: winget install ffmpeg  OR  brew install ffmpeg");
                callback(
                    "FFmpeg required for video files but not found.\n" +
                    "Install it:\n" +
                    "  Windows: winget install ffmpeg\n" +
                    "  Mac: brew install ffmpeg\n" +
                    "Then restart Premiere Pro."
                );
                return;
            }

            console.log("  FFmpeg: " + ffmpegPath);

            var cp = nr("child_process");
            // Extract audio: mono, 22050Hz, WAV piped to stdout — fast & tiny
            var args = ["-i", rawPath, "-vn", "-ac", "1", "-ar", "22050", "-f", "wav", "pipe:1"];
            console.log("  Running: ffmpeg " + args.join(" ").substring(0, 80) + "...");

            var chunks = [];
            var totalBytes = 0;
            var stderr = "";

            var proc;
            try {
                proc = cp.spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
            } catch (e) {
                console.error("  spawn failed: " + e.message);
                callback("FFmpeg spawn error: " + e.message);
                return;
            }

            proc.stdout.on("data", function (chunk) {
                chunks.push(chunk);
                totalBytes += chunk.length;
            });
            proc.stderr.on("data", function (d) { stderr += d.toString(); });

            proc.on("close", function (code) {
                console.log("  FFmpeg done: " + (totalBytes / 1024).toFixed(0) + "KB, exit=" + code);
                if (totalBytes === 0) {
                    console.error("  FFmpeg stderr: " + stderr.substring(0, 400));
                    callback("FFmpeg produced no audio output for " + clip.name + ". File may have no audio track.");
                    return;
                }
                var combined = Buffer.concat(chunks);
                var ab = combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength);
                decodeArrayBuffer(ab, clip, callback);
            });

            proc.on("error", function (err) {
                console.error("  FFmpeg process error: " + err.message);
                callback("FFmpeg error: " + err.message);
            });
        });
    }

    var _ffmpegCache = null;
    function findFFmpeg(nr, callback) {
        if (_ffmpegCache) { callback(_ffmpegCache); return; }

        // Check localStorage
        try {
            var cached = localStorage.getItem("deadair_ffmpeg");
            if (cached) {
                var fs = nr("fs");
                if (fs.existsSync(cached)) {
                    console.log("  FFmpeg (cached): " + cached);
                    _ffmpegCache = cached;
                    callback(cached);
                    return;
                }
                localStorage.removeItem("deadair_ffmpeg");
            }
        } catch (e) {}

        var isWin = navigator.platform.indexOf("Win") !== -1;
        var cp = nr("child_process");
        var fs = nr("fs");

        // Try PATH first
        var whichCmd = isWin ? "where ffmpeg" : "which ffmpeg";
        cp.exec(whichCmd, function (err, stdout) {
            if (!err && stdout && stdout.trim()) {
                var p = stdout.trim().split("\n")[0].trim();
                console.log("  FFmpeg on PATH: " + p);
                _ffmpegCache = p;
                try { localStorage.setItem("deadair_ffmpeg", p); } catch (e) {}
                callback(p);
                return;
            }

            // Check common install locations
            var paths = isWin ? [
                "C:\\ffmpeg\\bin\\ffmpeg.exe",
                "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
                "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe"
            ] : [
                "/usr/local/bin/ffmpeg",
                "/opt/homebrew/bin/ffmpeg",
                "/usr/bin/ffmpeg"
            ];

            for (var i = 0; i < paths.length; i++) {
                try {
                    if (fs.existsSync(paths[i])) {
                        console.log("  FFmpeg found at: " + paths[i]);
                        _ffmpegCache = paths[i];
                        try { localStorage.setItem("deadair_ffmpeg", paths[i]); } catch (e) {}
                        callback(paths[i]);
                        return;
                    }
                } catch (e) {}
            }

            console.warn("  FFmpeg not found in PATH or common locations");
            callback(null);
        });
    }

    function decodeArrayBuffer(ab, clip, callback) {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) { callback("Web Audio API unavailable"); return; }
        var ctx = new AudioCtx();
        console.log("  Decoding " + (ab.byteLength / 1024).toFixed(0) + "KB with Web Audio API...");
        ctx.decodeAudioData(ab,
            function (buffer) {
                ctx.close();
                console.log("  OK: " + buffer.numberOfChannels + "ch " + buffer.sampleRate + "Hz " + buffer.duration.toFixed(1) + "s");
                callback(null, buffer, clip);
            },
            function (err) {
                ctx.close();
                var msg = "Decode failed: " + (err ? err.message || String(err) : "unknown codec");
                console.error("  " + msg);
                callback(msg);
            }
        );
    }

    function loadViaXHR(rawPath, clip, callback) {
        var urlPath = rawPath.replace(/\\/g, "/");
        if (urlPath.charAt(0) !== "/") urlPath = "/" + urlPath;
        var fileUrl = "file://" + urlPath;
        console.log("  Strategy: XHR fallback — " + fileUrl);

        var xhr = new XMLHttpRequest();
        xhr.open("GET", fileUrl, true);
        xhr.responseType = "arraybuffer";
        xhr.timeout = 30000;
        xhr.ontimeout = function () { callback("XHR timeout for " + clip.name); };
        xhr.onerror   = function () { callback("XHR error for " + clip.name + " (status " + xhr.status + ")"); };
        xhr.onload = function () {
            console.log("  XHR status=" + xhr.status + " bytes=" + (xhr.response ? xhr.response.byteLength : 0));
            if (!xhr.response || xhr.response.byteLength === 0) {
                callback("XHR returned empty body — video files require Node.js (enable-nodejs flag missing?)");
                return;
            }
            decodeArrayBuffer(xhr.response, clip, callback);
        };
        xhr.send();
    }

    // ============================================================
    // SILENCE DETECTION
    // ============================================================

    function findSilentRegions(buffer, clip, thresholdLinear, minDuration, padding) {
        var sampleRate  = buffer.sampleRate;
        var numChannels = buffer.numberOfChannels;
        var windowSize  = Math.max(1, Math.floor(sampleRate * 0.05)); // 50ms

        var startSample = Math.floor(clip.inPointSeconds * sampleRate);
        var endSample   = Math.floor(clip.outPointSeconds * sampleRate);
        endSample = Math.min(endSample, buffer.length);

        // Fallback: use full buffer if in/out points look wrong
        if (endSample <= startSample || endSample === 0) {
            console.warn("  in/out samples invalid — using full buffer");
            startSample = 0;
            endSample = buffer.length;
        }

        console.log("  Scanning " + ((endSample - startSample) / sampleRate).toFixed(1) + "s (" + (endSample - startSample) + " samples, window=" + windowSize + ")");
        console.log("  Threshold linear=" + thresholdLinear.toFixed(4) + " (" + (20 * Math.log10(thresholdLinear)).toFixed(1) + "dB), minDur=" + minDuration + "s");

        var channels = [];
        for (var c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

        var regions = [];
        var inSilence = false;
        var silenceStart = 0;
        var totalWindows = 0;
        var silentWindows = 0;
        var globalMax = 0;
        var globalMin = Infinity;
        var preFilterRegions = 0;

        for (var i = startSample; i < endSample; i += windowSize) {
            var maxAmp = 0;
            var wEnd = Math.min(i + windowSize, endSample);

            for (var j = i; j < wEnd; j++) {
                for (var c = 0; c < channels.length; c++) {
                    var v = Math.abs(channels[c][j]);
                    if (v > maxAmp) maxAmp = v;
                }
            }

            totalWindows++;
            if (maxAmp > globalMax) globalMax = maxAmp;
            if (maxAmp < globalMin) globalMin = maxAmp;

            var sourceOffset = (i - startSample) / sampleRate;
            var timelineSec  = clip.startSeconds + sourceOffset;

            if (maxAmp < thresholdLinear) {
                silentWindows++;
                if (!inSilence) {
                    inSilence = true;
                    silenceStart = timelineSec;
                }
            } else {
                if (inSilence) {
                    inSilence = false;
                    preFilterRegions++;
                    var dur = timelineSec - silenceStart;
                    if (dur >= minDuration) {
                        pushRegion(regions, silenceStart + padding, timelineSec - padding);
                    }
                }
            }
        }

        if (inSilence) {
            preFilterRegions++;
            var dur = clip.endSeconds - silenceStart;
            if (dur >= minDuration) {
                pushRegion(regions, silenceStart + padding, clip.endSeconds - padding);
            }
        }

        var maxDb = globalMax > 0 ? (20 * Math.log10(globalMax)).toFixed(1) : "-inf";
        var minDb = globalMin < Infinity && globalMin > 0 ? (20 * Math.log10(globalMin)).toFixed(1) : "-inf";
        console.log("  Peak amp: " + globalMax.toFixed(4) + " (" + maxDb + "dB)  Floor: " + globalMin.toFixed(6) + " (" + minDb + "dB)");
        console.log("  Windows: " + totalWindows + " total, " + silentWindows + " silent (" + ((silentWindows/totalWindows)*100).toFixed(0) + "%)");
        console.log("  Regions before minDur filter: " + preFilterRegions + "  After: " + regions.length);

        if (regions.length === 0 && silentWindows === 0) {
            console.warn("  NO silent windows at all — try a higher threshold (closer to 0dB)");
            console.warn("  Suggested threshold: " + maxDb + "dB (peak) — try " + Math.max(-10, Math.ceil(parseFloat(maxDb) - 10)) + "dB");
        } else if (regions.length === 0 && preFilterRegions > 0) {
            console.warn("  Found " + preFilterRegions + " silent regions but all shorter than minDuration=" + minDuration + "s — lower minDuration");
        }

        return regions;
    }

    function pushRegion(regions, start, end) {
        if (end - start > 0.05) {
            regions.push({ start: round3(start), end: round3(end) });
        }
    }

    // ============================================================
    // FINISH ANALYSIS
    // ============================================================

    function finishAnalysis(allRegions, loadFails, totalClips) {
        var merged = mergeRegions(allRegions);
        var totalSilence = 0;
        for (var i = 0; i < merged.length; i++) totalSilence += merged[i].end - merged[i].start;

        analysisResults = { regions: merged, totalSilence: round3(totalSilence) };
        setProgress(100);

        setTimeout(function () {
            hideProgress();
            dom.btnAnalyze.disabled = false;
            dom.btnAuto.disabled = false;

            // Build status message
            var suffix = "";
            if (loadFails > 0 && loadFails === totalClips) {
                // ALL clips failed — likely file access issue
                showStatus(
                    "Could not load any audio files. Try: Window → Preferences → Audio → ensure clips are online. " +
                    "Video-only clips (no audio) are also skipped.",
                    "error"
                );
                return;
            }
            if (loadFails > 0) {
                suffix = " (" + loadFails + "/" + totalClips + " clips skipped — codec or offline)";
            }

            if (merged.length === 0) {
                showStatus(
                    "No silence found at " + dom.threshold.value + "dB" + suffix +
                    ". Try the Auto button or raise the threshold.",
                    "info"
                );
                return;
            }

            dom.regionCount.textContent = merged.length + " region" + (merged.length !== 1 ? "s" : "");
            dom.totalSilence.textContent = formatDuration(totalSilence) + " total";
            dom.results.classList.remove("hidden");
            dom.confirmActions.classList.remove("hidden");
            showStatus("Found " + merged.length + " silent regions" + suffix + ". Ready to remove.", "success");
        }, 200);
    }

    function mergeRegions(regions) {
        if (!regions.length) return [];
        regions.sort(function (a, b) { return a.start - b.start; });
        var merged = [{ start: regions[0].start, end: regions[0].end }];
        for (var i = 1; i < regions.length; i++) {
            var last = merged[merged.length - 1];
            if (regions[i].start <= last.end + 0.05) {
                if (regions[i].end > last.end) last.end = regions[i].end;
            } else {
                merged.push({ start: regions[i].start, end: regions[i].end });
            }
        }
        return merged;
    }

    // ============================================================
    // EXECUTE REMOVAL
    // ============================================================

    function executeRemoval() {
        if (!analysisResults || !analysisResults.regions.length) {
            showStatus("No results. Run analysis first.", "error"); return;
        }

        var mode        = document.querySelector('input[name="cut-mode"]:checked').value;
        var trackIndices = getSelectedTrackIndices();
        var esc = function (s) { return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; };
        var regionsStr  = JSON.stringify(analysisResults.regions);
        var tracksStr   = JSON.stringify(trackIndices);

        dom.btnExecute.disabled = true;
        dom.btnCancel.disabled  = true;
        showStatus("Applying to timeline...", "info");

        var call;
        if (mode === "markers") {
            call = "addSilenceMarkers(" + esc(regionsStr) + ")";
        } else if (mode === "disable") {
            call = "disableSilentRegions(" + esc(regionsStr) + "," + esc(tracksStr) + ")";
        } else {
            call = "rippleDeleteSilentRegions(" + esc(regionsStr) + "," + esc(tracksStr) + ")";
        }

        evalScript(call, function (resp) {
            dom.btnExecute.disabled = false;
            dom.btnCancel.disabled  = false;
            var r = parseResp(resp);
            if (r && r.success) {
                var count = r.data.markersAdded || r.data.disabledCount || r.data.deletedCount || 0;
                var label = mode === "markers" ? "markers" : mode === "disable" ? "clips disabled" : "regions deleted";
                showStatus(count + " " + label + ". Ctrl+Z to undo.", "success");
                cancelAnalysis();
            } else {
                showStatus("Error: " + (r ? r.error : "Unknown"), "error");
            }
        });
    }

    function cancelAnalysis() {
        analysisResults = null;
        hideResults();
        dom.confirmActions.classList.add("hidden");
    }

    // ============================================================
    // CLEAR MARKERS
    // ============================================================

    function clearMarkers() {
        evalScript("clearSilenceMarkers()", function (resp) {
            var r = parseResp(resp);
            if (r && r.success) {
                showStatus("Removed " + r.data.removed + " silence markers.", "success");
            } else {
                showStatus("Failed: " + (r ? r.error : "Unknown"), "error");
            }
        });
    }

    // ============================================================
    // SETTINGS
    // ============================================================

    function saveSettings() {
        try {
            localStorage.setItem("deadair_settings", JSON.stringify({
                threshold:   dom.threshold.value,
                minDuration: dom.minDuration.value,
                padding:     dom.padding.value,
                cutMode:     document.querySelector('input[name="cut-mode"]:checked').value
            }));
        } catch (e) {}
    }

    function loadSettings() {
        try {
            var raw = localStorage.getItem("deadair_settings");
            if (!raw) return;
            var s = JSON.parse(raw);
            if (s.threshold)   { dom.threshold.value = s.threshold; dom.thresholdValue.textContent = s.threshold + " dB"; }
            if (s.minDuration) { dom.minDuration.value = s.minDuration; dom.durationValue.textContent = parseFloat(s.minDuration).toFixed(1) + "s"; }
            if (s.padding)     { dom.padding.value = s.padding; dom.paddingValue.textContent = s.padding + "ms"; }
            if (s.cutMode) {
                var radio = document.querySelector('input[name="cut-mode"][value="' + s.cutMode + '"]');
                if (radio) radio.checked = true;
            }
        } catch (e) {}
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function getSelectedTrackIndices() {
        var val = dom.trackSelect.value;
        if (val === "all") {
            var out = [];
            for (var i = 1; i < dom.trackSelect.options.length; i++) out.push(parseInt(dom.trackSelect.options[i].value));
            return out.length ? out : [0];
        }
        return [parseInt(val)];
    }

    function evalScript(script, cb) {
        cs.evalScript(script, function (resp) {
            // Pipe any ExtendScript logs into the debug panel
            if (resp && resp !== "undefined" && resp !== "EvalScript error.") {
                try {
                    var r = JSON.parse(resp);
                    if (r && r.logs && r.logs.length) {
                        for (var i = 0; i < r.logs.length; i++) {
                            var line = r.logs[i];
                            var type = /^ERROR/.test(line) ? "error" : /^WARN/.test(line) ? "warn" : "ok";
                            dbg(type, "[JSX] " + line);
                        }
                    }
                } catch (e) {}
            } else if (resp === "EvalScript error." || !resp) {
                console.error("evalScript failed for: " + script.substring(0, 60));
            }
            if (cb) cb(resp);
        });
    }

    function parseResp(resp) {
        if (!resp || resp === "undefined" || resp === "EvalScript error.") return null;
        try { return JSON.parse(resp); } catch (e) { return null; }
    }

    function round3(n) { return Math.round(n * 1000) / 1000; }

    function formatDuration(sec) {
        if (sec < 60) return sec.toFixed(1) + "s";
        return Math.floor(sec / 60) + "m " + Math.round(sec % 60) + "s";
    }

    function showStatus(msg, type) {
        dom.statusBar.className = "status-bar" + (type ? " " + type : "");
        dom.statusText.textContent = msg;
        dom.statusBar.classList.remove("hidden");
    }

    function hideStatus()   { dom.statusBar.classList.add("hidden"); }
    function showProgress(text, pct) {
        dom.progressContainer.classList.remove("hidden");
        dom.progressText.textContent = text;
        if (pct !== undefined) dom.progressFill.style.width = pct + "%";
    }
    function setProgress(pct) { dom.progressFill.style.width = pct + "%"; }
    function hideProgress()  { dom.progressContainer.classList.add("hidden"); }
    function hideResults()   { dom.results.classList.add("hidden"); }

    // ============================================================
    // START
    // ============================================================

    init();

})();
