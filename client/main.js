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

    function refreshTrackList() {
        console.log("Fetching sequence info...");
        evalScript("getSequenceInfo()", function (resp) {
            var r = parseResp(resp);
            if (!r || !r.success) {
                console.warn("No active sequence or evalScript error: " + resp);
                showStatus("Open a sequence to begin.", "info");
                return;
            }
            console.log("Sequence: " + r.data.name + " | Audio tracks: " + r.data.audioTracks.length);
            for (var i = 0; i < r.data.audioTracks.length; i++) {
                var t = r.data.audioTracks[i];
                console.log("  Track " + t.index + ": " + t.name + " (" + t.clipCount + " clips)");
            }
            hideStatus();
            var sel = dom.trackSelect;
            while (sel.options.length > 1) sel.remove(1);
            for (var i = 0; i < r.data.audioTracks.length; i++) {
                var t = r.data.audioTracks[i];
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
    // LOAD AUDIO BUFFER — handles both audio and video files
    // ============================================================

    function loadAudioBuffer(clip, callback) {
        var rawPath = clip.mediaPath;
        var urlPath = rawPath.replace(/\\/g, "/");
        if (urlPath.charAt(0) !== "/") urlPath = "/" + urlPath;
        var fileUrl = "file://" + urlPath;

        console.log("Loading: " + clip.name);
        console.log("  Path: " + rawPath);
        console.log("  URL:  " + fileUrl);
        console.log("  In=" + clip.inPointSeconds.toFixed(2) + "s Out=" + clip.outPointSeconds.toFixed(2) + "s Timeline=" + clip.startSeconds.toFixed(2) + "-" + clip.endSeconds.toFixed(2) + "s");

        var xhr = new XMLHttpRequest();
        xhr.open("GET", fileUrl, true);
        xhr.responseType = "arraybuffer";
        xhr.timeout = 30000;

        xhr.ontimeout = function () {
            console.error("TIMEOUT: " + clip.name);
            callback("Timeout loading: " + clip.name);
        };

        xhr.onerror = function () {
            console.error("XHR ERROR: " + clip.name + " status=" + xhr.status);
            callback("Cannot read file: " + rawPath + "\n  (Try: --allow-file-access-from-files may need Premiere restart)");
        };

        xhr.onload = function () {
            console.log("  XHR status=" + xhr.status + " bytes=" + (xhr.response ? xhr.response.byteLength : 0));

            if (!xhr.response || xhr.response.byteLength === 0) {
                console.error("  Empty response — file may be inaccessible or video-only");
                callback("Empty response for: " + clip.name + " — is it a video clip with no audio track?");
                return;
            }

            var AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                console.error("  Web Audio API missing");
                callback("Web Audio API not available in this CEP version.");
                return;
            }
            var ctx = new AudioCtx();
            console.log("  Decoding " + (xhr.response.byteLength / 1024).toFixed(0) + "KB...");

            ctx.decodeAudioData(
                xhr.response,
                function (buffer) {
                    ctx.close();
                    console.log("  Decoded OK: " + buffer.numberOfChannels + "ch " + buffer.sampleRate + "Hz " + buffer.duration.toFixed(1) + "s");
                    callback(null, buffer, clip);
                },
                function (decodeErr) {
                    ctx.close();
                    var msg = "Decode failed for " + clip.name + ": " + (decodeErr ? decodeErr.message || String(decodeErr) : "unknown codec");
                    console.error("  " + msg);
                    callback(msg);
                }
            );
        };

        xhr.send();
    }

    // ============================================================
    // SILENCE DETECTION
    // ============================================================

    function findSilentRegions(buffer, clip, thresholdLinear, minDuration, padding) {
        var sampleRate  = buffer.sampleRate;
        var numChannels = buffer.numberOfChannels;
        var windowSize  = Math.max(1, Math.floor(sampleRate * 0.05)); // 50ms windows

        // The portion of the source file used by this clip
        var startSample = Math.floor(clip.inPointSeconds * sampleRate);
        var endSample   = Math.floor(clip.outPointSeconds * sampleRate);
        endSample = Math.min(endSample, buffer.length);

        // Sanity check
        if (endSample <= startSample) {
            // Fallback: analyze entire buffer, map to timeline
            startSample = 0;
            endSample = Math.min(buffer.length, Math.floor(clip.durationSeconds * sampleRate));
        }

        var channels = [];
        for (var c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

        var regions = [];
        var inSilence = false;
        var silenceStart = 0;

        for (var i = startSample; i < endSample; i += windowSize) {
            var maxAmp = 0;
            var wEnd = Math.min(i + windowSize, endSample);

            for (var j = i; j < wEnd; j++) {
                for (var c = 0; c < channels.length; c++) {
                    var v = Math.abs(channels[c][j]);
                    if (v > maxAmp) maxAmp = v;
                }
            }

            // Convert sample position to timeline time
            var sourceOffset = (i - startSample) / sampleRate;
            var timelineSec  = clip.startSeconds + sourceOffset;

            if (maxAmp < thresholdLinear) {
                if (!inSilence) {
                    inSilence = true;
                    silenceStart = timelineSec;
                }
            } else {
                if (inSilence) {
                    inSilence = false;
                    var dur = timelineSec - silenceStart;
                    if (dur >= minDuration) {
                        pushRegion(regions, silenceStart + padding, timelineSec - padding);
                    }
                }
            }
        }

        // Handle silence reaching clip end
        if (inSilence) {
            var dur = clip.endSeconds - silenceStart;
            if (dur >= minDuration) {
                pushRegion(regions, silenceStart + padding, clip.endSeconds - padding);
            }
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

    function evalScript(script, cb) { cs.evalScript(script, cb || function () {}); }

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
