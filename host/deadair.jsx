/**
 * DeadAir - Silence Remover for Adobe Premiere Pro
 * ExtendScript backend for timeline manipulation
 *
 * MIT License - https://github.com/yourusername/deadair-premiere
 */

// ============================================================
// UTILITIES
// ============================================================

function jsonStringify(obj) {
    if (obj === null || obj === undefined) return "null";
    if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
    if (typeof obj === "string") {
        return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
    }
    if (obj instanceof Array) {
        var items = [];
        for (var i = 0; i < obj.length; i++) {
            items.push(jsonStringify(obj[i]));
        }
        return "[" + items.join(",") + "]";
    }
    if (typeof obj === "object") {
        var pairs = [];
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                pairs.push(jsonStringify(key) + ":" + jsonStringify(obj[key]));
            }
        }
        return "{" + pairs.join(",") + "}";
    }
    return "null";
}

function jsonParse(str) {
    // Use eval-based parse (ExtendScript has no JSON built-in)
    // Input is trusted (comes from our own Node process)
    return eval("(" + str + ")");
}

function result(data) {
    return jsonStringify({ success: true, data: data });
}

function error(msg) {
    return jsonStringify({ success: false, error: String(msg) });
}

// ============================================================
// SEQUENCE INFO
// ============================================================

function getSequenceInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence. Open a sequence first.");

        var audioTrackInfo = [];
        for (var i = 0; i < seq.audioTracks.numTracks; i++) {
            var track = seq.audioTracks[i];
            var clipCount = 0;
            for (var j = 0; j < track.clips.numItems; j++) {
                clipCount++;
            }
            audioTrackInfo.push({
                index: i,
                name: track.name,
                clipCount: clipCount
            });
        }

        var videoTrackInfo = [];
        for (var i = 0; i < seq.videoTracks.numTracks; i++) {
            var track = seq.videoTracks[i];
            var clipCount = 0;
            for (var j = 0; j < track.clips.numItems; j++) {
                clipCount++;
            }
            videoTrackInfo.push({
                index: i,
                name: track.name,
                clipCount: clipCount
            });
        }

        return result({
            name: seq.name,
            id: seq.sequenceID,
            timebase: seq.timebase,
            framerate: seq.framerate ? seq.framerate : "unknown",
            zeroPoint: seq.zeroPoint ? seq.zeroPoint.ticks : "0",
            end: seq.end ? seq.end.ticks : "0",
            audioTracks: audioTrackInfo,
            videoTracks: videoTrackInfo
        });
    } catch (e) {
        return error("getSequenceInfo: " + e.toString());
    }
}

// ============================================================
// GET CLIP MEDIA PATHS (for FFmpeg analysis)
// ============================================================

function getClipMediaPaths(trackIndicesStr) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");

        var trackIndices = jsonParse(trackIndicesStr);
        var clips = [];

        for (var t = 0; t < trackIndices.length; t++) {
            var trackIdx = trackIndices[t];
            if (trackIdx < 0 || trackIdx >= seq.audioTracks.numTracks) continue;

            var track = seq.audioTracks[trackIdx];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var mediaPath = "";
                try {
                    if (clip.projectItem) {
                        mediaPath = clip.projectItem.getMediaPath();
                    }
                } catch (pathErr) {
                    mediaPath = "";
                }

                clips.push({
                    trackIndex: trackIdx,
                    clipIndex: c,
                    name: clip.name,
                    startTicks: clip.start.ticks,
                    endTicks: clip.end.ticks,
                    inPointTicks: clip.inPoint.ticks,
                    outPointTicks: clip.outPoint.ticks,
                    startSeconds: parseFloat(clip.start.seconds),
                    endSeconds: parseFloat(clip.end.seconds),
                    inPointSeconds: parseFloat(clip.inPoint.seconds),
                    outPointSeconds: parseFloat(clip.outPoint.seconds),
                    durationSeconds: parseFloat(clip.duration.seconds),
                    mediaPath: mediaPath
                });
            }
        }

        return result(clips);
    } catch (e) {
        return error("getClipMediaPaths: " + e.toString());
    }
}

// ============================================================
// ADD MARKERS AT SILENCE REGIONS
// ============================================================

function addSilenceMarkers(regionsStr) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");

        var regions = jsonParse(regionsStr);
        var count = 0;

        for (var i = 0; i < regions.length; i++) {
            var region = regions[i];
            var startTime = region.start;
            var duration = region.end - region.start;

            var marker = seq.markers.createMarker(startTime);
            marker.name = "Silence";
            marker.comments = "Duration: " + duration.toFixed(2) + "s";
            marker.setTypeAsComment();
            // Set marker end to create a range marker
            try {
                marker.end = new Time();
                marker.end.seconds = region.end;
            } catch (markerErr) {
                // Range markers may not be supported in all versions
            }
            count++;
        }

        return result({ markersAdded: count });
    } catch (e) {
        return error("addSilenceMarkers: " + e.toString());
    }
}

// ============================================================
// RAZOR AND DISABLE SILENT REGIONS
// ============================================================

function disableSilentRegions(regionsStr, trackIndicesStr) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");

        var regions = jsonParse(regionsStr);
        var trackIndices = jsonParse(trackIndicesStr);

        // Process from end to start to preserve timecodes
        regions.sort(function (a, b) { return b.start - a.start; });

        var disabledCount = 0;

        for (var r = 0; r < regions.length; r++) {
            var region = regions[r];
            var startTime = region.start;
            var endTime = region.end;

            // Razor all tracks at region boundaries
            for (var t = 0; t < trackIndices.length; t++) {
                var trackIdx = trackIndices[t];
                if (trackIdx >= seq.audioTracks.numTracks) continue;
                var track = seq.audioTracks[trackIdx];

                // Find clips that overlap this silence region
                for (var c = track.clips.numItems - 1; c >= 0; c--) {
                    var clip = track.clips[c];
                    var clipStart = parseFloat(clip.start.seconds);
                    var clipEnd = parseFloat(clip.end.seconds);

                    // Check if clip overlaps with silence region
                    if (clipStart < endTime && clipEnd > startTime) {
                        // Need to split at region boundaries if they fall within clip
                        if (startTime > clipStart && startTime < clipEnd) {
                            track.razor(startTime);
                        }
                        if (endTime > clipStart && endTime < clipEnd) {
                            track.razor(endTime);
                        }
                    }
                }
            }

            // Also razor linked video tracks
            for (var v = 0; v < seq.videoTracks.numTracks; v++) {
                var vTrack = seq.videoTracks[v];
                for (var vc = vTrack.clips.numItems - 1; vc >= 0; vc--) {
                    var vClip = vTrack.clips[vc];
                    var vClipStart = parseFloat(vClip.start.seconds);
                    var vClipEnd = parseFloat(vClip.end.seconds);

                    if (vClipStart < endTime && vClipEnd > startTime) {
                        if (startTime > vClipStart && startTime < vClipEnd) {
                            vTrack.razor(startTime);
                        }
                        if (endTime > vClipStart && endTime < vClipEnd) {
                            vTrack.razor(endTime);
                        }
                    }
                }
            }
        }

        // Now disable the clips that fall within silence regions
        for (var r = 0; r < regions.length; r++) {
            var region = regions[r];
            var startTime = region.start;
            var endTime = region.end;

            for (var t = 0; t < trackIndices.length; t++) {
                var trackIdx = trackIndices[t];
                if (trackIdx >= seq.audioTracks.numTracks) continue;
                var track = seq.audioTracks[trackIdx];

                for (var c = 0; c < track.clips.numItems; c++) {
                    var clip = track.clips[c];
                    var cs = parseFloat(clip.start.seconds);
                    var ce = parseFloat(clip.end.seconds);

                    // Clip is within (or is) the silence region
                    if (cs >= startTime - 0.01 && ce <= endTime + 0.01) {
                        clip.disabled = true;
                        disabledCount++;
                    }
                }
            }

            // Disable corresponding video clips too
            for (var v = 0; v < seq.videoTracks.numTracks; v++) {
                var vTrack = seq.videoTracks[v];
                for (var vc = 0; vc < vTrack.clips.numItems; vc++) {
                    var vClip = vTrack.clips[vc];
                    var vcs = parseFloat(vClip.start.seconds);
                    var vce = parseFloat(vClip.end.seconds);

                    if (vcs >= startTime - 0.01 && vce <= endTime + 0.01) {
                        vClip.disabled = true;
                    }
                }
            }
        }

        return result({ disabledCount: disabledCount });
    } catch (e) {
        return error("disableSilentRegions: " + e.toString());
    }
}

// ============================================================
// RIPPLE DELETE SILENT REGIONS
// ============================================================

function rippleDeleteSilentRegions(regionsStr, trackIndicesStr) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");

        var regions = jsonParse(regionsStr);
        var trackIndices = jsonParse(trackIndicesStr);

        // CRITICAL: Sort from end to start to preserve timecodes
        regions.sort(function (a, b) { return b.start - a.start; });

        var deletedCount = 0;

        for (var r = 0; r < regions.length; r++) {
            var region = regions[r];
            var startTime = region.start;
            var endTime = region.end;

            // First, razor all affected tracks at the silence boundaries
            var allTrackIndices = trackIndices.slice(0);

            // Razor audio tracks
            for (var t = 0; t < allTrackIndices.length; t++) {
                var trackIdx = allTrackIndices[t];
                if (trackIdx >= seq.audioTracks.numTracks) continue;
                var track = seq.audioTracks[trackIdx];

                for (var c = track.clips.numItems - 1; c >= 0; c--) {
                    var clip = track.clips[c];
                    var clipStart = parseFloat(clip.start.seconds);
                    var clipEnd = parseFloat(clip.end.seconds);

                    if (clipStart < endTime && clipEnd > startTime) {
                        if (startTime > clipStart + 0.001 && startTime < clipEnd - 0.001) {
                            track.razor(startTime);
                        }
                        if (endTime > clipStart + 0.001 && endTime < clipEnd - 0.001) {
                            track.razor(endTime);
                        }
                    }
                }
            }

            // Razor video tracks
            for (var v = 0; v < seq.videoTracks.numTracks; v++) {
                var vTrack = seq.videoTracks[v];
                for (var vc = vTrack.clips.numItems - 1; vc >= 0; vc--) {
                    var vClip = vTrack.clips[vc];
                    var vClipStart = parseFloat(vClip.start.seconds);
                    var vClipEnd = parseFloat(vClip.end.seconds);

                    if (vClipStart < endTime && vClipEnd > startTime) {
                        if (startTime > vClipStart + 0.001 && startTime < vClipEnd - 0.001) {
                            vTrack.razor(startTime);
                        }
                        if (endTime > vClipStart + 0.001 && endTime < vClipEnd - 0.001) {
                            vTrack.razor(endTime);
                        }
                    }
                }
            }

            // Now select and remove clips within the silence region
            // We need to use QE DOM for ripple delete
            try {
                app.enableQE();
                var qeSeq = qe.project.getActiveSequence();

                // Deselect all first
                for (var t = 0; t < allTrackIndices.length; t++) {
                    var trackIdx = allTrackIndices[t];
                    if (trackIdx >= seq.audioTracks.numTracks) continue;
                    var track = seq.audioTracks[trackIdx];

                    for (var c = track.clips.numItems - 1; c >= 0; c--) {
                        var clip = track.clips[c];
                        var cs = parseFloat(clip.start.seconds);
                        var ce = parseFloat(clip.end.seconds);

                        if (cs >= startTime - 0.01 && ce <= endTime + 0.01) {
                            clip.setSelected(true);
                        }
                    }
                }

                // Also select matching video clips
                for (var v = 0; v < seq.videoTracks.numTracks; v++) {
                    var vTrack = seq.videoTracks[v];
                    for (var vc = vTrack.clips.numItems - 1; vc >= 0; vc--) {
                        var vClip = vTrack.clips[vc];
                        var vcs = parseFloat(vClip.start.seconds);
                        var vce = parseFloat(vClip.end.seconds);

                        if (vcs >= startTime - 0.01 && vce <= endTime + 0.01) {
                            vClip.setSelected(true);
                        }
                    }
                }

                // Ripple delete selected clips
                qeSeq.rippleDeleteSelection();
                deletedCount++;

            } catch (qeErr) {
                // Fallback: remove clips without ripple if QE is unavailable
                for (var t = 0; t < allTrackIndices.length; t++) {
                    var trackIdx = allTrackIndices[t];
                    if (trackIdx >= seq.audioTracks.numTracks) continue;
                    var track = seq.audioTracks[trackIdx];

                    for (var c = track.clips.numItems - 1; c >= 0; c--) {
                        var clip = track.clips[c];
                        var cs = parseFloat(clip.start.seconds);
                        var ce = parseFloat(clip.end.seconds);

                        if (cs >= startTime - 0.01 && ce <= endTime + 0.01) {
                            clip.remove(true, true);
                            deletedCount++;
                        }
                    }
                }
            }
        }

        return result({ deletedCount: deletedCount });
    } catch (e) {
        return error("rippleDeleteSilentRegions: " + e.toString());
    }
}

// ============================================================
// CLEAR SILENCE MARKERS
// ============================================================

function clearSilenceMarkers() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");

        var markers = seq.markers;
        var toRemove = [];
        var marker = markers.getFirstMarker();
        while (marker) {
            if (marker.name === "Silence") {
                toRemove.push(marker);
            }
            marker = markers.getNextMarker(marker);
        }

        for (var i = 0; i < toRemove.length; i++) {
            markers.deleteMarker(toRemove[i]);
        }

        return result({ removed: toRemove.length });
    } catch (e) {
        return error("clearSilenceMarkers: " + e.toString());
    }
}

// ============================================================
// GET EXTENSION PATH (for locating bundled Node scripts)
// ============================================================

function getExtensionPath() {
    try {
        var scriptFile = new File($.fileName);
        var extFolder = scriptFile.parent.parent; // host/ -> deadair-premiere/
        return result({ path: extFolder.fsName });
    } catch (e) {
        return error("getExtensionPath: " + e.toString());
    }
}

// ============================================================
// SETTINGS PERSISTENCE
// ============================================================

function saveSettings(settingsStr) {
    try {
        var scriptFile = new File($.fileName);
        var settingsFile = new File(scriptFile.parent.parent.fsName + "/settings.json");
        settingsFile.open("w");
        settingsFile.write(settingsStr);
        settingsFile.close();
        return result({ saved: true });
    } catch (e) {
        return error("saveSettings: " + e.toString());
    }
}

function loadSettings() {
    try {
        var scriptFile = new File($.fileName);
        var settingsFile = new File(scriptFile.parent.parent.fsName + "/settings.json");
        if (!settingsFile.exists) {
            return result(null);
        }
        settingsFile.open("r");
        var content = settingsFile.read();
        settingsFile.close();
        // Return raw string, client will parse
        return content;
    } catch (e) {
        return error("loadSettings: " + e.toString());
    }
}

// ============================================================
// GET FFMPEG PATH
// ============================================================

function getFFmpegPath() {
    try {
        var scriptFile = new File($.fileName);
        var extFolder = scriptFile.parent.parent;
        var binFolder = extFolder.fsName;

        // Check platform
        var isWindows = ($.os.indexOf("Windows") !== -1);
        var ffmpegName = isWindows ? "ffmpeg.exe" : "ffmpeg";

        // Check in bin/ folder first
        var localPath = binFolder + (isWindows ? "\\bin\\" : "/bin/") + ffmpegName;
        var localFile = new File(localPath);
        if (localFile.exists) {
            return result({ path: localPath, source: "bundled" });
        }

        // Check system PATH by trying common locations
        if (isWindows) {
            var commonPaths = [
                "C:\\ffmpeg\\bin\\ffmpeg.exe",
                "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
                "C:\\Users\\" + $.getenv("USERNAME") + "\\ffmpeg\\bin\\ffmpeg.exe"
            ];
            for (var i = 0; i < commonPaths.length; i++) {
                var f = new File(commonPaths[i]);
                if (f.exists) return result({ path: commonPaths[i], source: "system" });
            }
        } else {
            var commonPaths = [
                "/usr/local/bin/ffmpeg",
                "/usr/bin/ffmpeg",
                "/opt/homebrew/bin/ffmpeg"
            ];
            for (var i = 0; i < commonPaths.length; i++) {
                var f = new File(commonPaths[i]);
                if (f.exists) return result({ path: commonPaths[i], source: "system" });
            }
        }

        // Return empty - client will use system PATH
        return result({ path: ffmpegName, source: "path" });
    } catch (e) {
        return error("getFFmpegPath: " + e.toString());
    }
}
