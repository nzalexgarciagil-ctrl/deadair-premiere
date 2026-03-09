/**
 * DeadAir - Silence Remover for Adobe Premiere Pro
 * Frontend controller
 */

(function () {
    "use strict";

    var cs = new CSInterface();
    var analysisResults = null; // Cached silence regions from last analysis

    // ============================================================
    // DOM REFERENCES
    // ============================================================

    var dom = {
        statusBar: document.getElementById("status-bar"),
        statusText: document.getElementById("status-text"),
        threshold: document.getElementById("threshold"),
        thresholdValue: document.getElementById("threshold-value"),
        minDuration: document.getElementById("min-duration"),
        durationValue: document.getElementById("duration-value"),
        padding: document.getElementById("padding"),
        paddingValue: document.getElementById("padding-value"),
        trackSelect: document.getElementById("track-select"),
        btnAnalyze: document.getElementById("btn-analyze"),
        btnExecute: document.getElementById("btn-execute"),
        btnCancel: document.getElementById("btn-cancel"),
        btnClearMarkers: document.getElementById("btn-clear-markers"),
        confirmActions: document.getElementById("confirm-actions"),
        progressContainer: document.getElementById("progress-container"),
        progressFill: document.getElementById("progress-fill"),
        progressText: document.getElementById("progress-text"),
        results: document.getElementById("results"),
        regionCount: document.getElementById("region-count"),
        totalSilence: document.getElementById("total-silence")
    };

    // ============================================================
    // INITIALIZATION
    // ============================================================

    function init() {
        bindSliders();
        bindButtons();
        loadSettings();
        refreshTrackList();
    }

    // ============================================================
    // SLIDER BINDINGS
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
    // BUTTON BINDINGS
    // ============================================================

    function bindButtons() {
        dom.btnAnalyze.addEventListener("click", startAnalysis);
        dom.btnExecute.addEventListener("click", executeRemoval);
        dom.btnCancel.addEventListener("click", cancelAnalysis);
        dom.btnClearMarkers.addEventListener("click", clearMarkers);

        // Refresh track list when panel becomes visible
        cs.addEventListener("com.adobe.csxs.events.ApplicationActivate", refreshTrackList);
    }

    // ============================================================
    // TRACK LIST
    // ============================================================

    function refreshTrackList() {
        evalScript("getSequenceInfo()", function (response) {
            var r = parseResponse(response);
            if (!r || !r.success) return;

            var data = r.data;
            var select = dom.trackSelect;
            var currentVal = select.value;

            // Clear options except "All"
            while (select.options.length > 1) {
                select.remove(1);
            }

            for (var i = 0; i < data.audioTracks.length; i++) {
                var track = data.audioTracks[i];
                var opt = document.createElement("option");
                opt.value = String(track.index);
                opt.textContent = track.name + " (" + track.clipCount + " clips)";
                select.appendChild(opt);
            }

            // Restore previous selection if still valid
            if (currentVal) {
                for (var i = 0; i < select.options.length; i++) {
                    if (select.options[i].value === currentVal) {
                        select.value = currentVal;
                        break;
                    }
                }
            }
        });
    }

    // ============================================================
    // ANALYSIS
    // ============================================================

    function startAnalysis() {
        analysisResults = null;
        hideResults();
        showProgress("Preparing analysis...");
        dom.btnAnalyze.disabled = true;

        // Get selected track indices
        var trackIndices = getSelectedTrackIndices();

        // Get clip media paths from ExtendScript
        evalScript('getClipMediaPaths(' + JSON.stringify(JSON.stringify(trackIndices)) + ')', function (response) {
            var r = parseResponse(response);
            if (!r || !r.success) {
                showStatus("Failed to get clip info: " + (r ? r.error : "Unknown error"), "error");
                hideProgress();
                dom.btnAnalyze.disabled = false;
                return;
            }

            var clips = r.data;
            if (clips.length === 0) {
                showStatus("No clips found on selected tracks.", "error");
                hideProgress();
                dom.btnAnalyze.disabled = false;
                return;
            }

            // Check for clips without media paths
            var validClips = clips.filter(function (c) { return c.mediaPath && c.mediaPath.length > 0; });
            if (validClips.length === 0) {
                showStatus("No media files found. Clips may be offline.", "error");
                hideProgress();
                dom.btnAnalyze.disabled = false;
                return;
            }

            showProgress("Analyzing " + validClips.length + " clip(s)...");
            runFFmpegAnalysis(validClips);
        });
    }

    function runFFmpegAnalysis(clips) {
        var threshold = parseInt(dom.threshold.value);
        var duration = parseFloat(dom.minDuration.value);
        var paddingSec = parseInt(dom.padding.value) / 1000;

        // Get extension path for Node script location
        evalScript("getExtensionPath()", function (response) {
            var r = parseResponse(response);
            if (!r || !r.success) {
                showStatus("Cannot determine extension path.", "error");
                hideProgress();
                dom.btnAnalyze.disabled = false;
                return;
            }

            var extPath = r.data.path;
            var nodePath = extPath + getPathSep() + "node" + getPathSep() + "analyze.js";

            // Also get FFmpeg path
            evalScript("getFFmpegPath()", function (ffmpegResponse) {
                var fr = parseResponse(ffmpegResponse);
                var ffmpegPath = "ffmpeg";
                if (fr && fr.success && fr.data) {
                    ffmpegPath = fr.data.path;
                }

                // Build batch job
                var job = {
                    clips: clips.map(function (c) {
                        return {
                            mediaPath: c.mediaPath,
                            startSeconds: c.startSeconds,
                            endSeconds: c.endSeconds,
                            inPointSeconds: c.inPointSeconds
                        };
                    }),
                    threshold: threshold,
                    duration: duration,
                    padding: paddingSec,
                    ffmpeg: ffmpegPath,
                    mode: "intersection"
                };

                // Run Node.js analyzer
                var nodeBin = cs.getSystemPath(SystemPath.APPLICATION);
                // CEP provides a Node.js runtime we can use
                var nodeRuntime = getNodePath();

                showProgress("Running FFmpeg analysis...");
                setProgress(30);

                // Use CSInterface.evalScript to call system command via ExtendScript,
                // or use the built-in Node.js runtime
                runNodeProcess(nodeRuntime, nodePath, job, function (err, result) {
                    if (err) {
                        showStatus("Analysis failed: " + err, "error");
                        hideProgress();
                        dom.btnAnalyze.disabled = false;
                        return;
                    }

                    setProgress(100);

                    if (!result.success) {
                        showStatus("Analysis error: " + result.error, "error");
                        hideProgress();
                        dom.btnAnalyze.disabled = false;
                        return;
                    }

                    analysisResults = result.data;
                    showAnalysisResults(result.data);
                    hideProgress();
                    dom.btnAnalyze.disabled = false;
                });
            });
        });
    }

    function runNodeProcess(nodePath, scriptPath, job, callback) {
        // Use CEP's built-in Node.js to spawn the analysis process
        try {
            var childProcess = cep_node.require("child_process");
            var jobStr = JSON.stringify(job);

            var proc = childProcess.spawn(nodePath, [scriptPath], {
                stdio: ["pipe", "pipe", "pipe"]
            });

            var stdout = "";
            var stderr = "";

            proc.stdout.on("data", function (data) {
                stdout += data.toString();
            });

            proc.stderr.on("data", function (data) {
                stderr += data.toString();
            });

            proc.on("close", function (code) {
                try {
                    // Try stdout first, then stderr for the JSON result
                    var output = stdout.trim() || stderr.trim();
                    var result = JSON.parse(output);
                    callback(null, result);
                } catch (e) {
                    callback("Failed to parse analysis result. stdout: " + stdout.substring(0, 200) +
                             " stderr: " + stderr.substring(0, 200));
                }
            });

            proc.on("error", function (err) {
                callback("Failed to start analyzer: " + err.message +
                         "\n\nMake sure Node.js is installed.");
            });

            // Send job via stdin
            proc.stdin.write(jobStr);
            proc.stdin.end();

            // Progress simulation
            var progressInterval = setInterval(function () {
                var current = parseInt(dom.progressFill.style.width) || 30;
                if (current < 90) {
                    setProgress(current + 5);
                }
            }, 500);

            proc.on("close", function () {
                clearInterval(progressInterval);
            });

        } catch (e) {
            callback("Node.js runtime unavailable: " + e.message +
                     "\n\nCEP Node.js integration required.");
        }
    }

    // ============================================================
    // RESULTS DISPLAY
    // ============================================================

    function showAnalysisResults(data) {
        dom.regionCount.textContent = data.regions.length + " region" + (data.regions.length !== 1 ? "s" : "");
        dom.totalSilence.textContent = formatDuration(data.totalSilence);
        dom.results.classList.remove("hidden");
        dom.confirmActions.classList.remove("hidden");

        if (data.regions.length === 0) {
            showStatus("No silence detected with current settings. Try adjusting the threshold.", "");
            dom.confirmActions.classList.add("hidden");
        } else {
            showStatus("Found " + data.regions.length + " silent regions. Review and confirm.", "success");
        }
    }

    // ============================================================
    // EXECUTE REMOVAL
    // ============================================================

    function executeRemoval() {
        if (!analysisResults || analysisResults.regions.length === 0) {
            showStatus("No analysis results. Run analysis first.", "error");
            return;
        }

        var mode = document.querySelector('input[name="cut-mode"]:checked').value;
        var trackIndices = getSelectedTrackIndices();
        var regionsStr = JSON.stringify(analysisResults.regions);
        var trackIndicesStr = JSON.stringify(trackIndices);

        dom.btnExecute.disabled = true;
        dom.btnCancel.disabled = true;

        showStatus("Applying changes...", "");

        var escRegions = escapeForEval(regionsStr);
        var escTracks = escapeForEval(trackIndicesStr);

        if (mode === "markers") {
            evalScript('addSilenceMarkers(' + escRegions + ')', function (response) {
                handleExecuteResult(response, "markers");
            });
        } else if (mode === "disable") {
            evalScript('disableSilentRegions(' + escRegions + ',' + escTracks + ')', function (response) {
                handleExecuteResult(response, "disabled");
            });
        } else {
            // Ripple delete
            evalScript('rippleDeleteSilentRegions(' + escRegions + ',' + escTracks + ')', function (response) {
                handleExecuteResult(response, "deleted");
            });
        }
    }

    function handleExecuteResult(response, action) {
        var r = parseResponse(response);
        dom.btnExecute.disabled = false;
        dom.btnCancel.disabled = false;

        if (r && r.success) {
            var msg;
            if (action === "markers") {
                msg = "Added " + r.data.markersAdded + " markers. Use Ctrl+Z to undo.";
            } else if (action === "disabled") {
                msg = "Disabled " + r.data.disabledCount + " clip segments. Use Ctrl+Z to undo.";
            } else {
                msg = "Ripple deleted " + r.data.deletedCount + " regions. Use Ctrl+Z to undo.";
            }
            showStatus(msg, "success");
            cancelAnalysis(); // Reset UI
        } else {
            showStatus("Failed: " + (r ? r.error : "Unknown error"), "error");
        }
    }

    function cancelAnalysis() {
        analysisResults = null;
        hideResults();
        dom.confirmActions.classList.add("hidden");
        hideStatus();
    }

    // ============================================================
    // CLEAR MARKERS
    // ============================================================

    function clearMarkers() {
        evalScript("clearSilenceMarkers()", function (response) {
            var r = parseResponse(response);
            if (r && r.success) {
                showStatus("Removed " + r.data.removed + " silence markers.", "success");
            } else {
                showStatus("Failed to clear markers: " + (r ? r.error : "Unknown"), "error");
            }
        });
    }

    // ============================================================
    // SETTINGS PERSISTENCE
    // ============================================================

    function getSettings() {
        return {
            threshold: dom.threshold.value,
            minDuration: dom.minDuration.value,
            padding: dom.padding.value,
            trackSelect: dom.trackSelect.value,
            cutMode: document.querySelector('input[name="cut-mode"]:checked').value
        };
    }

    function saveSettings() {
        var settings = getSettings();
        var settingsStr = JSON.stringify(settings);
        evalScript('saveSettings(' + escapeForEval(settingsStr) + ')');
    }

    function loadSettings() {
        evalScript("loadSettings()", function (response) {
            if (!response || response === "null" || response === "EvalScript error.") return;

            try {
                var settings;
                // Response might be double-wrapped
                try {
                    var outer = JSON.parse(response);
                    if (outer.success && outer.data) {
                        settings = outer.data;
                    } else {
                        settings = JSON.parse(response);
                    }
                } catch (e) {
                    settings = JSON.parse(response);
                }

                if (settings.threshold !== undefined) {
                    dom.threshold.value = settings.threshold;
                    dom.thresholdValue.textContent = settings.threshold + " dB";
                }
                if (settings.minDuration !== undefined) {
                    dom.minDuration.value = settings.minDuration;
                    dom.durationValue.textContent = parseFloat(settings.minDuration).toFixed(1) + "s";
                }
                if (settings.padding !== undefined) {
                    dom.padding.value = settings.padding;
                    dom.paddingValue.textContent = settings.padding + "ms";
                }
                if (settings.cutMode) {
                    var radio = document.querySelector('input[name="cut-mode"][value="' + settings.cutMode + '"]');
                    if (radio) radio.checked = true;
                }
            } catch (e) {
                // Settings file may not exist yet
            }
        });
    }

    // ============================================================
    // HELPERS
    // ============================================================

    function getSelectedTrackIndices() {
        var val = dom.trackSelect.value;
        if (val === "all") {
            var indices = [];
            for (var i = 1; i < dom.trackSelect.options.length; i++) {
                indices.push(parseInt(dom.trackSelect.options[i].value));
            }
            // If no tracks loaded yet, default to track 0
            return indices.length > 0 ? indices : [0];
        }
        return [parseInt(val)];
    }

    function evalScript(script, callback) {
        cs.evalScript(script, callback || function () { });
    }

    function parseResponse(response) {
        if (!response || response === "undefined" || response === "EvalScript error.") {
            return null;
        }
        try {
            return JSON.parse(response);
        } catch (e) {
            return null;
        }
    }

    function escapeForEval(str) {
        // Escape string for passing through evalScript
        return "'" + str.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
    }

    function getPathSep() {
        return navigator.platform.indexOf("Win") !== -1 ? "\\" : "/";
    }

    function getNodePath() {
        // CEP bundles Node.js - find the executable
        if (navigator.platform.indexOf("Win") !== -1) {
            return "node";
        }
        return "/usr/local/bin/node";
    }

    function formatDuration(seconds) {
        if (seconds < 60) {
            return seconds.toFixed(1) + "s";
        }
        var mins = Math.floor(seconds / 60);
        var secs = Math.round(seconds % 60);
        return mins + "m " + secs + "s";
    }

    // UI helpers
    function showStatus(msg, type) {
        dom.statusBar.className = "status-bar" + (type ? " " + type : "");
        dom.statusText.textContent = msg;
        dom.statusBar.classList.remove("hidden");
    }

    function hideStatus() {
        dom.statusBar.classList.add("hidden");
    }

    function showProgress(text) {
        dom.progressContainer.classList.remove("hidden");
        dom.progressText.textContent = text || "Processing...";
        dom.progressFill.style.width = "0%";
    }

    function setProgress(pct) {
        dom.progressFill.style.width = Math.min(pct, 100) + "%";
    }

    function hideProgress() {
        dom.progressContainer.classList.add("hidden");
    }

    function hideResults() {
        dom.results.classList.add("hidden");
    }

    // ============================================================
    // STARTUP
    // ============================================================

    init();

})();
