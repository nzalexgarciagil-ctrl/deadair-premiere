/**
 * DeadAir - Silence Remover for Adobe Premiere Pro
 * Frontend controller — uses Web Audio API for analysis, no FFmpeg required.
 */

(function () {
    "use strict";

    var cs = new CSInterface();
    var analysisResults = null;

    // ============================================================
    // DOM REFERENCES
    // ============================================================

    var dom = {
        statusBar:       document.getElementById("status-bar"),
        statusText:      document.getElementById("status-text"),
        threshold:       document.getElementById("threshold"),
        thresholdValue:  document.getElementById("threshold-value"),
        minDuration:     document.getElementById("min-duration"),
        durationValue:   document.getElementById("duration-value"),
        padding:         document.getElementById("padding"),
        paddingValue:    document.getElementById("padding-value"),
        trackSelect:     document.getElementById("track-select"),
        btnAnalyze:      document.getElementById("btn-analyze"),
        btnExecute:      document.getElementById("btn-execute"),
        btnCancel:       document.getElementById("btn-cancel"),
        btnClearMarkers: document.getElementById("btn-clear-markers"),
        confirmActions:  document.getElementById("confirm-actions"),
        progressContainer: document.getElementById("progress-container"),
        progressFill:    document.getElementById("progress-fill"),
        progressText:    document.getElementById("progress-text"),
        results:         document.getElementById("results"),
        regionCount:     document.getElementById("region-count"),
        totalSilence:    document.getElementById("total-silence")
    };

    // ============================================================
    // INIT
    // ============================================================

    function init() {
        bindSliders();
        bindButtons();
        loadSettings();
        setTimeout(refreshTrackList, 500);
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
        dom.btnExecute.addEventListener("click", executeRemoval);
        dom.btnCancel.addEventListener("click", cancelAnalysis);
        dom.btnClearMarkers.addEventListener("click", clearMarkers);
    }

    // ============================================================
    // TRACK LIST
    // ============================================================

    function refreshTrackList() {
        evalScript("getSequenceInfo()", function (resp) {
            var r = parseResp(resp);
            if (!r || !r.success) {
                showStatus("Open a sequence to begin.", "info");
                return;
            }
            hideStatus();
            var sel = dom.trackSelect;
            while (sel.options.length > 1) sel.remove(1);
            var data = r.data;
            for (var i = 0; i < data.audioTracks.length; i++) {
                var t = data.audioTracks[i];
                var opt = document.createElement("option");
                opt.value = String(t.index);
                opt.textContent = t.name + " (" + t.clipCount + " clips)";
                sel.appendChild(opt);
            }
        });
    }

    // ============================================================
    // ANALYSIS — Web Audio API (no FFmpeg required)
    // ============================================================

    function startAnalysis() {
        analysisResults = null;
        hideResults();
        dom.btnAnalyze.disabled = true;
        dom.confirmActions.classList.add("hidden");

        var trackIndices = getSelectedTrackIndices();

        showProgress("Getting clip info...", 5);
        evalScript('getClipMediaPaths(' + JSON.stringify(JSON.stringify(trackIndices)) + ')', function (resp) {
            var r = parseResp(resp);
            if (!r || !r.success) {
                showStatus("Failed to get clip info: " + (r ? r.error : "ExtendScript error"), "error");
                hideProgress(); dom.btnAnalyze.disabled = false; return;
            }

            var clips = r.data.filter(function (c) { return c.mediaPath && c.mediaPath.length > 0; });
            if (clips.length === 0) {
                showStatus("No clips with media found on selected tracks.", "error");
                hideProgress(); dom.btnAnalyze.disabled = false; return;
            }

            analyzeClipsWithWebAudio(clips);
        });
    }

    function analyzeClipsWithWebAudio(clips) {
        var threshold = parseFloat(dom.threshold.value);
        var minDuration = parseFloat(dom.minDuration.value);
        var paddingSec = parseInt(dom.padding.value) / 1000;

        var thresholdLinear = Math.pow(10, threshold / 20);
        var allRegions = [];
        var idx = 0;

        function processNext() {
            if (idx >= clips.length) {
                finishAnalysis(allRegions);
                return;
            }
            var clip = clips[idx++];
            var pct = Math.round((idx / clips.length) * 85) + 5;
            showProgress("Analyzing clip " + idx + " of " + clips.length + "...", pct);

            analyzeOneClip(clip, thresholdLinear, minDuration, paddingSec)
                .then(function (regions) {
                    for (var i = 0; i < regions.length; i++) allRegions.push(regions[i]);
                    processNext();
                })
                .catch(function (err) {
                    console.warn("[DeadAir] Skipping clip (decode error):", clip.name, err.message || err);
                    processNext(); // Skip unreadable clips, continue
                });
        }

        processNext();
    }

    /**
     * Analyze a single clip for silence using the Web Audio API.
     * Returns a Promise resolving to an array of {start, end} regions in timeline seconds.
     */
    function analyzeOneClip(clip, thresholdLinear, minDuration, padding) {
        return new Promise(function (resolve, reject) {
            // Build a file:// URL from the OS path
            var fileUrl = "file:///" + clip.mediaPath.replace(/\\/g, "/").replace(/^\//, "");

            // Fetch the file as an ArrayBuffer
            var xhr = new XMLHttpRequest();
            xhr.open("GET", fileUrl, true);
            xhr.responseType = "arraybuffer";

            xhr.onerror = function () {
                reject(new Error("Failed to load: " + clip.mediaPath));
            };

            xhr.onload = function () {
                if (xhr.status !== 0 && xhr.status !== 200) {
                    reject(new Error("HTTP " + xhr.status + " loading " + clip.mediaPath));
                    return;
                }
                if (!xhr.response || xhr.response.byteLength === 0) {
                    reject(new Error("Empty response for " + clip.mediaPath));
                    return;
                }

                var AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) {
                    reject(new Error("Web Audio API not available"));
                    return;
                }
                var ctx = new AudioCtx();

                ctx.decodeAudioData(
                    xhr.response,
                    function (buffer) {
                        ctx.close();
                        var regions = findSilentRegions(buffer, clip, thresholdLinear, minDuration, padding);
                        resolve(regions);
                    },
                    function (err) {
                        ctx.close();
                        reject(new Error("Decode failed for " + clip.name + ": " + (err ? err.message : "unknown")));
                    }
                );
            };

            xhr.send();
        });
    }

    /**
     * Scan decoded AudioBuffer for silent regions.
     * Converts source-file timestamps → timeline timestamps.
     */
    function findSilentRegions(buffer, clip, thresholdLinear, minDuration, padding) {
        var sampleRate = buffer.sampleRate;
        var numChannels = buffer.numberOfChannels;

        // Only analyze the portion of the file used in the timeline (in-point to out-point)
        var startSample = Math.floor(clip.inPointSeconds * sampleRate);
        var endSample   = Math.floor(clip.outPointSeconds * sampleRate);
        endSample = Math.min(endSample, buffer.length);

        // Build channel data references
        var channels = [];
        for (var c = 0; c < numChannels; c++) {
            channels.push(buffer.getChannelData(c));
        }

        // Analyze in 50ms windows
        var windowSize = Math.max(1, Math.floor(sampleRate * 0.05));
        var regions = [];
        var inSilence = false;
        var silenceStart = 0;

        for (var i = startSample; i < endSample; i += windowSize) {
            var maxAmp = 0;
            var wEnd = Math.min(i + windowSize, endSample);

            // Find peak amplitude across all channels in this window
            for (var j = i; j < wEnd; j++) {
                for (var c = 0; c < channels.length; c++) {
                    var v = channels[c][j];
                    if (v < 0) v = -v;
                    if (v > maxAmp) maxAmp = v;
                }
            }

            // Time of this window in the SOURCE file
            var sourceTimeSec = i / sampleRate;
            // Convert to timeline time: offset from in-point, added to clip's timeline start
            var timelineSec = clip.startSeconds + (sourceTimeSec - clip.inPointSeconds);

            if (maxAmp < thresholdLinear) {
                if (!inSilence) {
                    inSilence = true;
                    silenceStart = timelineSec;
                }
            } else {
                if (inSilence) {
                    inSilence = false;
                    var silenceDuration = timelineSec - silenceStart;
                    if (silenceDuration >= minDuration) {
                        var s = silenceStart + padding;
                        var e = timelineSec   - padding;
                        if (e - s > 0.05) regions.push({ start: round3(s), end: round3(e) });
                    }
                }
            }
        }

        // Handle silence extending to clip end
        if (inSilence) {
            var clipEndTimeline = clip.endSeconds;
            var silenceDuration = clipEndTimeline - silenceStart;
            if (silenceDuration >= minDuration) {
                var s = silenceStart + padding;
                var e = clipEndTimeline - padding;
                if (e - s > 0.05) regions.push({ start: round3(s), end: round3(e) });
            }
        }

        return regions;
    }

    function finishAnalysis(allRegions) {
        // Merge overlapping regions and sort
        var merged = mergeRegions(allRegions);
        var totalSilence = 0;
        for (var i = 0; i < merged.length; i++) {
            totalSilence += merged[i].end - merged[i].start;
        }

        analysisResults = { regions: merged, totalSilence: round3(totalSilence) };
        setProgress(100);

        setTimeout(function () {
            hideProgress();
            dom.btnAnalyze.disabled = false;

            if (merged.length === 0) {
                showStatus("No silence detected. Try a higher threshold (less negative).", "info");
                return;
            }

            dom.regionCount.textContent = merged.length + " region" + (merged.length !== 1 ? "s" : "");
            dom.totalSilence.textContent = formatDuration(totalSilence) + " total";
            dom.results.classList.remove("hidden");
            dom.confirmActions.classList.remove("hidden");
            showStatus("Found " + merged.length + " silent regions. Ready to remove.", "success");
        }, 300);
    }

    function mergeRegions(regions) {
        if (!regions.length) return [];
        regions.sort(function (a, b) { return a.start - b.start; });
        var merged = [{ start: regions[0].start, end: regions[0].end }];
        for (var i = 1; i < regions.length; i++) {
            var last = merged[merged.length - 1];
            if (regions[i].start <= last.end + 0.1) {
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
            showStatus("No results. Run analysis first.", "error");
            return;
        }

        var mode         = document.querySelector('input[name="cut-mode"]:checked').value;
        var trackIndices = getSelectedTrackIndices();
        var regionsStr   = JSON.stringify(analysisResults.regions);
        var tracksStr    = JSON.stringify(trackIndices);

        dom.btnExecute.disabled = true;
        dom.btnCancel.disabled  = true;
        showStatus("Applying to timeline...", "info");

        var esc = function (s) { return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'"; };

        var scriptCall;
        if (mode === "markers") {
            scriptCall = "addSilenceMarkers(" + esc(regionsStr) + ")";
        } else if (mode === "disable") {
            scriptCall = "disableSilentRegions(" + esc(regionsStr) + "," + esc(tracksStr) + ")";
        } else {
            scriptCall = "rippleDeleteSilentRegions(" + esc(regionsStr) + "," + esc(tracksStr) + ")";
        }

        evalScript(scriptCall, function (resp) {
            dom.btnExecute.disabled = false;
            dom.btnCancel.disabled  = false;

            var r = parseResp(resp);
            if (r && r.success) {
                var count = r.data.markersAdded || r.data.disabledCount || r.data.deletedCount || 0;
                var verb  = mode === "markers" ? "markers added" : mode === "disable" ? "clips disabled" : "regions deleted";
                showStatus(count + " " + verb + ". Press Ctrl+Z to undo.", "success");
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

    function getSettings() {
        return {
            threshold:   dom.threshold.value,
            minDuration: dom.minDuration.value,
            padding:     dom.padding.value,
            cutMode:     document.querySelector('input[name="cut-mode"]:checked').value
        };
    }

    function saveSettings() {
        try {
            localStorage.setItem("deadair_settings", JSON.stringify(getSettings()));
        } catch (e) {}
    }

    function loadSettings() {
        try {
            var raw = localStorage.getItem("deadair_settings");
            if (!raw) return;
            var s = JSON.parse(raw);
            if (s.threshold !== undefined) {
                dom.threshold.value = s.threshold;
                dom.thresholdValue.textContent = s.threshold + " dB";
            }
            if (s.minDuration !== undefined) {
                dom.minDuration.value = s.minDuration;
                dom.durationValue.textContent = parseFloat(s.minDuration).toFixed(1) + "s";
            }
            if (s.padding !== undefined) {
                dom.padding.value = s.padding;
                dom.paddingValue.textContent = s.padding + "ms";
            }
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
            for (var i = 1; i < dom.trackSelect.options.length; i++) {
                out.push(parseInt(dom.trackSelect.options[i].value));
            }
            return out.length ? out : [0];
        }
        return [parseInt(val)];
    }

    function evalScript(script, cb) {
        cs.evalScript(script, cb || function () {});
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

    function hideStatus() { dom.statusBar.classList.add("hidden"); }

    function showProgress(text, pct) {
        dom.progressContainer.classList.remove("hidden");
        dom.progressText.textContent = text;
        if (pct !== undefined) dom.progressFill.style.width = pct + "%";
    }

    function setProgress(pct) { dom.progressFill.style.width = pct + "%"; }

    function hideProgress() { dom.progressContainer.classList.add("hidden"); }

    function hideResults() { dom.results.classList.add("hidden"); }

    // ============================================================
    // STARTUP
    // ============================================================

    init();

})();
