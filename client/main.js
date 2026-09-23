/**
 * DeadAir - Silence Remover for Adobe Premiere Pro
 * Frontend controller. Web Audio analysis with FFmpeg extraction when needed.
 */

(function () {
    "use strict";

    var core = window.DeadAirCore;
    if (!core) throw new Error("DeadAir core helpers failed to load.");

    var cs = new CSInterface();
    var analysisResults = null;
    var lastLoadedClips = null;
    var busy = false;
    var selectedRegion = 0;

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
            this.setAttribute("aria-expanded", String(!panel.classList.contains("hidden")));
            this.textContent = panel.classList.contains("hidden") ? "Show debug log" : "Hide debug log";
        });

        document.getElementById("btn-clear-log").addEventListener("click", function () {
            _logEl.innerHTML = "";
        });

        document.getElementById("btn-copy-log").addEventListener("click", function () {
            var lines = _logEl.querySelectorAll(".log-line");
            var text = Array.prototype.map.call(lines, function (l) { return l.textContent; }).join("\n");
            if (!text) { return; }
            var copy = navigator.clipboard && navigator.clipboard.writeText
                ? navigator.clipboard.writeText(text) : Promise.reject(new Error("Clipboard unavailable"));
            copy.then(function () {
                var btn = document.getElementById("btn-copy-log");
                btn.textContent = "Copied";
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
                btn.textContent = "Copied";
                setTimeout(function () { btn.textContent = "Copy"; }, 1500);
            });
        });

        // Log system info immediately
        console.log("DeadAir v1.2.0 ready");
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
        thresholdNumber:  document.getElementById("threshold-number"),
        minDuration:      document.getElementById("min-duration"),
        durationNumber:   document.getElementById("duration-number"),
        padding:          document.getElementById("padding"),
        paddingNumber:    document.getElementById("padding-number"),
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
        speechLevelLabel: document.getElementById("speech-level-label"),
        sequenceName:     document.getElementById("sequence-name"),
        sequenceDetail:   document.getElementById("sequence-detail"),
        btnRefresh:       document.getElementById("btn-refresh"),
        multiTrackWarning: document.getElementById("multi-track-warning"),
        analysisSummary:  document.getElementById("analysis-summary"),
        regionSelect:     document.getElementById("region-select"),
        regionMap:        document.getElementById("region-map"),
        btnPrevious:      document.getElementById("btn-previous"),
        btnNext:          document.getElementById("btn-next"),
        btnPreview:       document.getElementById("btn-preview"),
        affectedTracks:   document.getElementById("affected-tracks"),
        timingSummary:    document.getElementById("timing-summary"),
        editWarning:      document.getElementById("edit-warning"),
        editAcknowledgement: document.getElementById("edit-acknowledgement"),
        confirmEdit:      document.getElementById("confirm-edit")
    };

    // ============================================================
    // INIT
    // ============================================================

    function init() {
        initDebugPanel();
        bindSliders();
        bindButtons();
        loadSettings();
        updateModeUi();
        setTimeout(refreshTrackList, 600);
    }

    // ============================================================
    // SLIDERS
    // ============================================================

    function setThreshold(value, persist) {
        var normalized = core.normalizeThreshold(value);
        dom.threshold.value = normalized;
        dom.thresholdNumber.value = normalized;
        if (persist) detectionChanged();
    }

    function bindSliders() {
        dom.threshold.addEventListener("input", function () { setThreshold(this.value, true); });
        dom.thresholdNumber.addEventListener("change", function () { setThreshold(this.value, true); });
        function bindPair(slider, number, min, max, step, fallback) {
            function update(value) {
                var normalized = core.normalizeSetting(value, min, max, step, fallback);
                slider.value = normalized;
                number.value = normalized;
                detectionChanged();
            }
            slider.addEventListener("input", function () { update(this.value); });
            number.addEventListener("change", function () { update(this.value); });
        }
        bindPair(dom.minDuration, dom.durationNumber, 0.1, 5, 0.1, 0.8);
        bindPair(dom.padding, dom.paddingNumber, 0, 500, 10, 100);
        dom.trackSelect.addEventListener("change", function () {
            detectionChanged();
            updateSourceWarning();
        });
    }

    function detectionChanged() {
        var hadResults = !!analysisResults;
        cancelAnalysis();
        lastLoadedClips = null;
        dom.noiseHint.classList.add("hidden");
        saveSettings();
        if (hadResults) showStatus("Detection changed. Find quiet sections again before applying an action.", "info");
    }

    function setBusy(value) {
        busy = value;
        var controls = document.querySelectorAll("button, input, select");
        for (var i = 0; i < controls.length; i++) controls[i].disabled = value;
        if (!value) {
            var ready = !!seqSettings && seqSettings.audioTracks.some(function (track) { return track.clipCount > 0; });
            dom.btnAnalyze.disabled = !ready;
            dom.btnAuto.disabled = !ready;
            dom.trackSelect.disabled = !ready;
            dom.btnClearMarkers.disabled = !seqSettings;
            updateModeUi();
            updateRegionPreview();
        }
        document.getElementById("panel-content").setAttribute("aria-busy", String(value));
    }

    function updateSourceWarning() {
        dom.multiTrackWarning.classList.toggle("hidden", dom.trackSelect.value !== "all" || !seqSettings || seqSettings.audioTracks.length < 2);
    }

    // ============================================================
    // BUTTONS
    // ============================================================

    function bindButtons() {
        dom.btnAnalyze.addEventListener("click", startAnalysis);
        dom.btnAuto.addEventListener("click", runAutoDetect);
        dom.btnExecute.addEventListener("click", executeRemoval);
        dom.btnCancel.addEventListener("click", function () {
            cancelAnalysis();
            showStatus("Results cleared. No clips changed.", "info");
            dom.btnAnalyze.focus();
        });
        dom.btnClearMarkers.addEventListener("click", clearMarkers);
        dom.btnRefresh.addEventListener("click", function () { refreshTrackList(); });
        dom.confirmEdit.addEventListener("change", updateModeUi);
        dom.regionSelect.addEventListener("change", function () {
            selectedRegion = parseInt(this.value, 10);
            updateRegionPreview();
        });
        dom.btnPrevious.addEventListener("click", function () { selectedRegion--; updateRegionPreview(); });
        dom.btnNext.addEventListener("click", function () { selectedRegion++; updateRegionPreview(); });
        dom.btnPreview.addEventListener("click", previewRegion);
        var modes = document.querySelectorAll('input[name="cut-mode"]');
        for (var i = 0; i < modes.length; i++) {
            modes[i].addEventListener("change", function () {
                dom.confirmEdit.checked = false;
                updateModeUi();
            });
        }
    }

    function getSelectedMode() {
        return document.querySelector('input[name="cut-mode"]:checked').value;
    }

    function updateModeUi() {
        var mode = getSelectedMode();
        var editsClips = mode !== "markers";
        dom.btnExecute.textContent = core.modeInfo(mode).button;
        dom.btnExecute.disabled = busy || !analysisResults || (editsClips && !dom.confirmEdit.checked);
        dom.editAcknowledgement.classList.toggle("hidden", !editsClips);
        dom.editWarning.classList.toggle("hidden", !editsClips);
        dom.affectedTracks.textContent = core.affectedTracksText(mode, seqSettings);
        dom.timingSummary.textContent = core.timingText(mode, analysisResults ? analysisResults.totalSilence : 0);
        dom.editWarning.textContent = mode === "ripple"
            ? "Close gaps also removes existing gaps on each track. This can change intended timing and A/V sync. Use a duplicate sequence, or choose Markers only."
            : "This changes clips on all video and audio tracks, not just the audio source selected above. Save a copy of the sequence first.";
    }

    function updateRegionPreview() {
        var regions = analysisResults ? analysisResults.regions : [];
        selectedRegion = Math.max(0, Math.min(selectedRegion, regions.length - 1));
        dom.regionSelect.value = String(selectedRegion);
        dom.btnPrevious.disabled = busy || selectedRegion === 0;
        dom.btnNext.disabled = busy || selectedRegion >= regions.length - 1;
        dom.btnPreview.disabled = busy || !regions.length;
        var spans = dom.regionMap.children;
        for (var i = 0; i < spans.length; i++) spans[i].className = i === selectedRegion ? "selected" : "";
        if (regions.length) dom.regionMap.setAttribute("aria-label", "Region " + (selectedRegion + 1) + " of " + regions.length + ". " + core.regionLabel(regions[selectedRegion]));
    }

    function renderRegions() {
        dom.regionSelect.innerHTML = "";
        dom.regionMap.innerHTML = "";
        var regions = analysisResults.regions;
        var duration = Math.max(seqSettings.durationSecs || 0, regions[regions.length - 1].end);
        for (var i = 0; i < regions.length; i++) {
            var option = document.createElement("option");
            option.value = String(i);
            option.textContent = (i + 1) + ". " + core.regionLabel(regions[i]);
            dom.regionSelect.appendChild(option);
            var span = document.createElement("span");
            span.style.left = (regions[i].start / duration * 100) + "%";
            span.style.width = ((regions[i].end - regions[i].start) / duration * 100) + "%";
            dom.regionMap.appendChild(span);
        }
        selectedRegion = 0;
        updateRegionPreview();
    }

    function previewRegion() {
        if (busy || !analysisResults) return;
        var region = analysisResults.regions[selectedRegion];
        setBusy(true);
        evalScript("previewSilenceRegion(" + JSON.stringify(analysisResults.sequenceID) + "," + region.start + ")", function (resp) {
            setBusy(false);
            var r = parseResp(resp);
            if (r && r.success) showStatus("Playhead at " + core.formatPosition(region.start) + ". Press Play in Premiere to listen.", "info");
            else showStatus(r ? r.error : "Premiere did not respond. Refresh the source and try again.", "error");
        });
    }

    // ============================================================
    // TRACK LIST
    // ============================================================

    var seqSettings = null; // populated by refreshTrackList, used throughout

    function refreshTrackList(callback) {
        if (busy) return;
        cancelAnalysis();
        lastLoadedClips = null;
        setBusy(true);
        evalScript("getSequenceInfo()", function (resp) {
            var r = parseResp(resp);
            if (!r || !r.success) {
                seqSettings = null;
                dom.sequenceName.textContent = "No active sequence";
                dom.sequenceDetail.textContent = "Open a sequence in Premiere, then choose Refresh.";
                dom.trackSelect.innerHTML = '<option value="all">All audio tracks</option>';
                updateSourceWarning();
                setBusy(false);
                showStatus(r ? r.error : "Cannot connect to Premiere. Reopen the panel and try again.", "error");
                if (callback) callback(false);
                return;
            }
            seqSettings = r.data;
            var previous = dom.trackSelect.value;
            var sel = dom.trackSelect;
            while (sel.options.length > 1) sel.remove(1);
            for (var i = 0; i < seqSettings.audioTracks.length; i++) {
                var t = seqSettings.audioTracks[i];
                var opt = document.createElement("option");
                opt.value = String(t.index);
                opt.textContent = "A" + (t.index + 1) + " · " + t.name + " (" + t.clipCount + " clips)";
                sel.appendChild(opt);
            }
            sel.value = previous;
            if (!sel.value) sel.value = "all";
            dom.sequenceName.textContent = seqSettings.name;
            dom.sequenceDetail.textContent = seqSettings.audioTracks.length + " audio tracks · " + seqSettings.videoTracks.length + " video tracks";
            updateSourceWarning();
            setBusy(false);
            hideStatus();
            if (dom.btnAnalyze.disabled) showStatus("This sequence has no audio clips. Add audio, then choose Refresh.", "info");
            if (callback) callback(!dom.btnAnalyze.disabled);
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
        if (busy) return;
        refreshTrackList(function (ready) {
            if (!ready) return;
            setBusy(true);
            dom.noiseHint.classList.add("hidden");
            showProgress("Loading audio for the threshold estimate...", 5);
            getClips(function (err, clips) {
                if (err) {
                    showStatus(err, "error");
                    hideProgress();
                    setBusy(false);
                    return;
                }
                var sampleClips = clips.slice(0, 3);
                var allWindowDb = [];
                var idx = 0;
                var loadFails = 0;
                function scanNext() {
                    if (idx >= sampleClips.length) {
                        finishAutoDetect(allWindowDb, loadFails, sampleClips.length);
                        return;
                    }
                    var clip = sampleClips[idx++];
                    showProgress("Estimating from clip " + idx + " of " + sampleClips.length + "...", 15 + Math.round(idx / sampleClips.length * 75));
                    loadAudioBuffer(clip, function (err, buffer, usedClip) {
                        if (err || !buffer) loadFails++;
                        else {
                            var values = collectWindowDb(buffer, usedClip);
                            for (var i = 0; i < values.length; i++) allWindowDb.push(values[i]);
                        }
                        scanNext();
                    });
                }
                scanNext();
            });
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
            // Match the manual threshold range so very quiet recordings remain measurable.
            var db = maxAmp > 0 ? 20 * Math.log10(maxAmp) : core.THRESHOLD_MIN;
            if (db < core.THRESHOLD_MIN) db = core.THRESHOLD_MIN;
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
     *   5. Clamp to -95dB .. -15dB
     */
    function finishAutoDetect(allDb, loadFails, totalClips) {
        hideProgress();
        setBusy(false);
        if (allDb.length === 0) {
            showStatus("Could not read audio for an estimate. Check that media is online and FFmpeg is installed for video or large audio files. Open Help for the debug log.", "error");
            return;
        }
        var suggestion = core.suggestThreshold(allDb);
        setThreshold(suggestion.threshold, true);
        dom.noiseFloorLabel.textContent = "Quiet level: " + Math.round(suggestion.noiseFloor) + " dB";
        dom.speechLevelLabel.textContent = "Louder audio: " + Math.round(suggestion.speechLevel) + " dB";
        dom.noiseHint.classList.remove("hidden");
        var msg = "Estimated " + suggestion.threshold + " dB. Find quiet sections to review the result.";
        if (loadFails) msg += " Skipped " + loadFails + " of " + totalClips + " sampled clips. Check Help before editing.";
        showStatus(msg, loadFails ? "info" : "success");
    }

    // ============================================================
    // MAIN ANALYSIS
    // ============================================================

    function startAnalysis() {
        if (busy) return;
        refreshTrackList(function (ready) {
            if (!ready) return;
            setBusy(true);
            showProgress("Reading audio clips...", 5);
            getClips(function (err, clips) {
                if (err) {
                    showStatus(err, "error");
                    hideProgress();
                    setBusy(false);
                    return;
                }
                analyzeClips(clips);
            });
        });
    }

    function analyzeClips(clips) {
        var thresholdLinear = core.thresholdToLinear(dom.threshold.value);
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
            showProgress("Analyzing clip " + idx + " of " + clips.length + ": " + clip.name, pct);

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
                // CEP does not reliably deliver asynchronous Node callbacks.
                console.log("  Strategy: fs.readFileSync (audio, small)");
                try {
                    var data = fs.readFileSync(rawPath);
                    var ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                    decodeArrayBuffer(ab, clip, callback);
                } catch (readError) {
                    console.warn("  fs.readFileSync failed: " + readError.message + " — trying FFmpeg");
                    tryFFmpeg(rawPath, clip, nr, callback);
                }
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
                    "FFmpeg is needed for this video or large audio file, but was not found.\n" +
                    "Install it:\n" +
                    "  Windows: winget install ffmpeg\n" +
                    "  Mac: brew install ffmpeg\n" +
                    "Then restart Premiere Pro."
                );
                return;
            }

            console.log("  FFmpeg: " + ffmpegPath);

            var cp = nr("child_process");
            var clipDuration = Math.max(0, clip.outPointSeconds - clip.inPointSeconds);
            // Extract only the source range used on the timeline: mono, 22050Hz WAV.
            var args = [
                "-hide_banner", "-loglevel", "error",
                "-ss", String(clip.inPointSeconds),
                "-t", String(clipDuration),
                "-i", rawPath,
                "-vn", "-ac", "1", "-ar", "22050", "-f", "wav", "pipe:1"
            ];
            console.log("  Running bounded FFmpeg extraction for " + clipDuration.toFixed(1) + "s");

            var execution;
            try {
                execution = cp.spawnSync(ffmpegPath, args, {
                    encoding: null,
                    windowsHide: true,
                    timeout: 600000,
                    maxBuffer: 512 * 1024 * 1024
                });
            } catch (spawnError) {
                console.error("  FFmpeg spawn failed: " + spawnError.message);
                callback("FFmpeg spawn error: " + spawnError.message);
                return;
            }

            var output = execution.stdout;
            var stderr = execution.stderr ? execution.stderr.toString() : "";
            var totalBytes = output ? output.length : 0;
            console.log("  FFmpeg done: " + (totalBytes / 1024).toFixed(0) + "KB, exit=" + execution.status);
            if (execution.error || execution.status !== 0 || totalBytes === 0) {
                var reason = execution.error ? execution.error.message : stderr.substring(0, 400);
                console.error("  FFmpeg failed: " + reason);
                callback("FFmpeg could not extract audio from " + clip.name + ": " + reason);
                return;
            }

            var extractedClip = {};
            for (var key in clip) {
                if (clip.hasOwnProperty(key)) extractedClip[key] = clip[key];
            }
            extractedClip.inPointSeconds = 0;
            extractedClip.outPointSeconds = clipDuration;

            var ab = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
            decodeArrayBuffer(ab, extractedClip, callback);
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

        // CEP can strand callbacks from child_process.exec, so use the direct,
        // bounded executable lookup instead of launching through a shell.
        try {
            var locator = isWin ? "where.exe" : "which";
            var stdout = cp.execFileSync(locator, ["ffmpeg"], {
                encoding: "utf8",
                windowsHide: true,
                timeout: 5000
            });
            if (stdout && stdout.trim()) {
                var resolved = stdout.trim().split(/\r?\n/)[0].trim();
                if (fs.existsSync(resolved)) {
                    console.log("  FFmpeg on PATH: " + resolved);
                    _ffmpegCache = resolved;
                    try { localStorage.setItem("deadair_ffmpeg", resolved); } catch (e) {}
                    callback(resolved);
                    return;
                }
            }
        } catch (lookupError) {
            console.warn("  FFmpeg PATH lookup failed: " + lookupError.message);
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
        if (isWin) {
            try {
                paths.push(nr("path").join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links", "ffmpeg.exe"));
            } catch (e) {}
        }

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
        hideProgress();
        if (loadFails === totalClips) {
            setBusy(false);
            showStatus("Could not read any audio. Check that media is online. Video and large audio files need FFmpeg. Open Help for the debug log.", "error");
            return;
        }
        var suffix = loadFails ? " Skipped " + loadFails + " of " + totalClips + " clips. These results are incomplete." : "";
        if (!merged.length) {
            setBusy(false);
            showStatus("No quiet sections found at " + dom.threshold.value + " dB. Try Estimate threshold or a higher value." + suffix, "info");
            return;
        }
        analysisResults = { regions: merged, totalSilence: round3(totalSilence), sequenceID: seqSettings.sequenceID };
        dom.regionCount.textContent = merged.length + " region" + (merged.length === 1 ? "" : "s");
        dom.totalSilence.textContent = formatDuration(totalSilence) + " of quiet audio";
        dom.analysisSummary.textContent = "Analyzed " + (totalClips - loadFails) + " of " + totalClips + " clips at " + dom.threshold.value + " dB. If you edit the timeline, find quiet sections again." + suffix;
        document.querySelector('input[name="cut-mode"][value="markers"]').checked = true;
        dom.confirmEdit.checked = false;
        renderRegions();
        dom.results.classList.remove("hidden");
        dom.confirmActions.classList.remove("hidden");
        dom.btnAnalyze.classList.add("hidden");
        setBusy(false);
        showStatus("Review the highlighted sections before choosing an action." + suffix, loadFails ? "info" : "success");
        var heading = document.getElementById("results-heading");
        heading.focus();
        heading.scrollIntoView({ block: "start" });
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
        if (busy || !analysisResults || !analysisResults.regions.length) return;
        var mode = getSelectedMode();
        if (mode !== "markers" && !dom.confirmEdit.checked) return;
        var modeInfo = core.modeInfo(mode);
        var args = [JSON.stringify(analysisResults.regions), JSON.stringify(getSelectedTrackIndices()), mode, analysisResults.sequenceID];
        var encoded = args.map(function (value) { return JSON.stringify(value); });
        setBusy(true);
        showStatus(modeInfo.progress, "info");
        evalScript("applyReviewedSilence(" + encoded.join(",") + ")", function (resp) {
            var r = parseResp(resp);
            if (r && r.success) {
                var count = r.data.markersAdded || r.data.disabledCount || r.data.deletedCount || 0;
                cancelAnalysis();
                setBusy(false);
                showStatus(count + " " + modeInfo.result + ". Review the sequence in Premiere.", count ? "success" : "info");
            } else {
                setBusy(false);
                showStatus(r ? r.error : "Premiere did not confirm the action. Inspect the timeline and debug log before retrying.", "error");
            }
        });
    }

    function cancelAnalysis() {
        analysisResults = null;
        selectedRegion = 0;
        dom.confirmEdit.checked = false;
        hideResults();
        dom.confirmActions.classList.add("hidden");
        dom.btnAnalyze.textContent = "Find quiet sections";
        dom.btnAnalyze.className = "btn btn-accent";
        updateModeUi();
    }

    // ============================================================
    // CLEAR MARKERS
    // ============================================================

    function clearMarkers() {
        if (busy) return;
        if (!window.confirm('Remove every marker named "Silence" from the active sequence? This also includes markers not created by DeadAir.')) return;
        setBusy(true);
        evalScript("clearSilenceMarkers()", function (resp) {
            setBusy(false);
            var r = parseResp(resp);
            if (r && r.success) showStatus("Removed " + r.data.removed + " markers named Silence.", "success");
            else showStatus(r ? r.error : "Premiere did not confirm marker removal. Check the sequence before retrying.", "error");
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
                padding:     dom.padding.value
            }));
        } catch (e) {}
    }

    function loadSettings() {
        try {
            var raw = localStorage.getItem("deadair_settings");
            if (!raw) return;
            var s = JSON.parse(raw);
            if (s.threshold !== undefined) setThreshold(s.threshold, false);
            if (s.minDuration !== undefined) dom.minDuration.value = dom.durationNumber.value = core.normalizeSetting(s.minDuration, 0.1, 5, 0.1, 0.8);
            if (s.padding !== undefined) dom.padding.value = dom.paddingNumber.value = core.normalizeSetting(s.padding, 0, 500, 10, 100);
            // Each analysis starts with marker review, even if an older panel saved a removal mode.
        } catch (e) { console.warn("Saved settings could not be read. Using defaults."); }
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
        return core.formatDuration(sec);
    }

    function showStatus(msg, type) {
        dom.statusBar.className = "status-bar" + (type ? " " + type : "");
        dom.statusText.textContent = msg;
        dom.statusBar.classList.remove("hidden");
    }

    function hideStatus()   { dom.statusText.textContent = ""; dom.statusBar.className = "status-bar is-empty"; }
    function showProgress(text, pct) {
        dom.progressContainer.classList.remove("hidden");
        dom.progressText.textContent = text;
        if (pct !== undefined) setProgress(pct);
    }
    function setProgress(pct) {
        dom.progressFill.style.width = pct + "%";
        dom.progressFill.parentNode.setAttribute("aria-valuenow", String(pct));
    }
    function hideProgress()  { dom.progressContainer.classList.add("hidden"); }
    function hideResults()   { dom.results.classList.add("hidden"); }

    // ============================================================
    // START
    // ============================================================

    init();

})();
