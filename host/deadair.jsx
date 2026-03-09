/**
 * DeadAir - Silence Remover for Adobe Premiere Pro
 * ExtendScript backend
 * MIT License
 */

// ============================================================
// UTILITIES
// ============================================================

function jsonStringify(obj) {
    if (obj === null || obj === undefined) return "null";
    if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
    if (typeof obj === "string") {
        return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
            .replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
    }
    if (obj instanceof Array) {
        var items = [];
        for (var i = 0; i < obj.length; i++) items.push(jsonStringify(obj[i]));
        return "[" + items.join(",") + "]";
    }
    if (typeof obj === "object") {
        var pairs = [];
        for (var key in obj) {
            if (obj.hasOwnProperty(key))
                pairs.push(jsonStringify(key) + ":" + jsonStringify(obj[key]));
        }
        return "{" + pairs.join(",") + "}";
    }
    return "null";
}

function jsonParse(str) { return eval("(" + str + ")"); }

// Accumulated log messages — returned with every response so JS can display them
var _logs = [];

function log(msg) {
    _logs.push(String(msg));
    $.writeln("[DeadAir] " + msg);
}

function result(data) {
    var out = jsonStringify({ success: true, data: data, logs: _logs });
    _logs = [];
    return out;
}

function error(msg) {
    log("ERROR: " + msg);
    var out = jsonStringify({ success: false, error: String(msg), logs: _logs });
    _logs = [];
    return out;
}

// ============================================================
// RAZOR HELPER — tries multiple approaches for cross-version compat
// ============================================================

function makeTime(seconds) {
    var t = new Time();
    t.seconds = parseFloat(seconds);
    return t;
}

function razorAt(seq, timeSec) {
    // Try 1: sequence-level razor with Time object
    try {
        var t = makeTime(timeSec);
        seq.razor(t.ticks);
        return "seq.razor(ticks)";
    } catch (e1) {}

    // Try 2: sequence razor with seconds float
    try {
        seq.razor(timeSec);
        return "seq.razor(sec)";
    } catch (e2) {}

    // Try 3: QE DOM razor
    try {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (qeSeq) {
            var t2 = makeTime(timeSec);
            qeSeq.razor(t2.ticks);
            return "qe.razor(ticks)";
        }
    } catch (e3) {}

    return null; // all failed
}

function trackRazorAt(track, timeSec) {
    // Try 1: Time object ticks
    try {
        var t = makeTime(timeSec);
        track.razor(t.ticks);
        return "track.razor(ticks)";
    } catch (e1) {}

    // Try 2: plain seconds float
    try {
        track.razor(timeSec);
        return "track.razor(sec)";
    } catch (e2) {}

    // Try 3: Time object directly
    try {
        var t3 = makeTime(timeSec);
        track.razor(t3);
        return "track.razor(Time)";
    } catch (e3) {}

    return null;
}

// ============================================================
// GET SEQUENCE INFO
// ============================================================

function getSequenceInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence. Open a sequence first.");

        var audioTracks = [];
        for (var i = 0; i < seq.audioTracks.numTracks; i++) {
            var t = seq.audioTracks[i];
            var n = 0;
            for (var j = 0; j < t.clips.numItems; j++) n++;
            audioTracks.push({ index: i, name: t.name, clipCount: n });
        }

        var videoTracks = [];
        for (var i = 0; i < seq.videoTracks.numTracks; i++) {
            var t = seq.videoTracks[i];
            var n = 0;
            for (var j = 0; j < t.clips.numItems; j++) n++;
            videoTracks.push({ index: i, name: t.name, clipCount: n });
        }

        return result({ name: seq.name, audioTracks: audioTracks, videoTracks: videoTracks });
    } catch (e) {
        return error("getSequenceInfo: " + e.toString());
    }
}

// ============================================================
// GET CLIP MEDIA PATHS
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
                    if (clip.projectItem) mediaPath = clip.projectItem.getMediaPath();
                } catch (pe) {}

                clips.push({
                    trackIndex: trackIdx,
                    clipIndex: c,
                    name: clip.name,
                    startSeconds:   parseFloat(clip.start.seconds),
                    endSeconds:     parseFloat(clip.end.seconds),
                    inPointSeconds: parseFloat(clip.inPoint.seconds),
                    outPointSeconds: parseFloat(clip.outPoint.seconds),
                    durationSeconds: parseFloat(clip.duration.seconds),
                    mediaPath: mediaPath
                });
            }
        }

        log("Returning " + clips.length + " clips");
        return result(clips);
    } catch (e) {
        return error("getClipMediaPaths: " + e.toString());
    }
}

// ============================================================
// ADD MARKERS
// ============================================================

function addSilenceMarkers(regionsStr) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");

        var regions = jsonParse(regionsStr);
        var count = 0;

        for (var i = 0; i < regions.length; i++) {
            var region = regions[i];
            try {
                var marker = seq.markers.createMarker(region.start);
                marker.name = "Silence";
                marker.comments = "Duration: " + (region.end - region.start).toFixed(2) + "s";
                marker.setTypeAsComment();
                count++;
            } catch (me) {
                log("Marker " + i + " failed: " + me.toString());
            }
        }

        log("Added " + count + " markers");
        return result({ markersAdded: count });
    } catch (e) {
        return error("addSilenceMarkers: " + e.toString());
    }
}

// ============================================================
// DISABLE SILENT REGIONS
// ============================================================

function disableSilentRegions(regionsStr, trackIndicesStr) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");

        var regions = jsonParse(regionsStr);
        var trackIndices = jsonParse(trackIndicesStr);
        regions.sort(function (a, b) { return b.start - a.start; });

        log("Disabling " + regions.length + " regions");

        // First pass: razor at all boundaries
        var razorMethod = "";
        for (var r = 0; r < regions.length; r++) {
            var s = regions[r].start;
            var e = regions[r].end;

            for (var t = 0; t < trackIndices.length; t++) {
                var tidx = trackIndices[t];
                if (tidx >= seq.audioTracks.numTracks) continue;
                var track = seq.audioTracks[tidx];
                for (var c = track.clips.numItems - 1; c >= 0; c--) {
                    var clip = track.clips[c];
                    var cs = parseFloat(clip.start.seconds);
                    var ce = parseFloat(clip.end.seconds);
                    if (cs < e && ce > s) {
                        if (s > cs + 0.001 && s < ce - 0.001) {
                            var m = trackRazorAt(track, s);
                            if (!razorMethod && m) razorMethod = m;
                            if (!m) log("WARN: razor at " + s.toFixed(3) + "s failed on audio track " + tidx);
                        }
                        if (e > cs + 0.001 && e < ce - 0.001) {
                            trackRazorAt(track, e);
                        }
                    }
                }
            }

            for (var v = 0; v < seq.videoTracks.numTracks; v++) {
                var vt = seq.videoTracks[v];
                for (var vc = vt.clips.numItems - 1; vc >= 0; vc--) {
                    var vclip = vt.clips[vc];
                    var vcs = parseFloat(vclip.start.seconds);
                    var vce = parseFloat(vclip.end.seconds);
                    if (vcs < e && vce > s) {
                        if (s > vcs + 0.001 && s < vce - 0.001) trackRazorAt(vt, s);
                        if (e > vcs + 0.001 && e < vce - 0.001) trackRazorAt(vt, e);
                    }
                }
            }
        }

        log("Razor method used: " + (razorMethod || "none needed or all failed"));

        // Second pass: disable clips within silence regions
        var disabledCount = 0;
        for (var r = 0; r < regions.length; r++) {
            var s = regions[r].start;
            var e = regions[r].end;

            for (var t = 0; t < trackIndices.length; t++) {
                var tidx = trackIndices[t];
                if (tidx >= seq.audioTracks.numTracks) continue;
                var track = seq.audioTracks[tidx];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var clip = track.clips[c];
                    var cs = parseFloat(clip.start.seconds);
                    var ce = parseFloat(clip.end.seconds);
                    if (cs >= s - 0.01 && ce <= e + 0.01) {
                        clip.disabled = true;
                        disabledCount++;
                    }
                }
            }

            for (var v = 0; v < seq.videoTracks.numTracks; v++) {
                var vt = seq.videoTracks[v];
                for (var vc = 0; vc < vt.clips.numItems; vc++) {
                    var vclip = vt.clips[vc];
                    var vcs = parseFloat(vclip.start.seconds);
                    var vce = parseFloat(vclip.end.seconds);
                    if (vcs >= s - 0.01 && vce <= e + 0.01) vclip.disabled = true;
                }
            }
        }

        log("Disabled " + disabledCount + " clip segments");
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

        // Process END → START to preserve timecodes
        regions.sort(function (a, b) { return b.start - a.start; });
        log("Ripple deleting " + regions.length + " regions (end→start)");

        // Enable QE DOM for ripple delete
        var hasQE = false;
        var qeSeq = null;
        try {
            app.enableQE();
            qeSeq = qe.project.getActiveSequence();
            hasQE = (qeSeq !== null && qeSeq !== undefined);
            log("QE DOM: " + (hasQE ? "available" : "unavailable"));
        } catch (qeErr) {
            log("QE DOM unavailable: " + qeErr.toString());
        }

        var deletedCount = 0;
        var razorMethod = "";

        for (var r = 0; r < regions.length; r++) {
            var startTime = regions[r].start;
            var endTime   = regions[r].end;
            log("Region " + r + ": " + startTime.toFixed(3) + "s → " + endTime.toFixed(3) + "s");

            // --- Razor audio tracks ---
            for (var t = 0; t < trackIndices.length; t++) {
                var tidx = trackIndices[t];
                if (tidx >= seq.audioTracks.numTracks) continue;
                var track = seq.audioTracks[tidx];

                for (var c = track.clips.numItems - 1; c >= 0; c--) {
                    var clip = track.clips[c];
                    var cs = parseFloat(clip.start.seconds);
                    var ce = parseFloat(clip.end.seconds);

                    if (cs < endTime && ce > startTime) {
                        if (startTime > cs + 0.001 && startTime < ce - 0.001) {
                            var m = trackRazorAt(track, startTime);
                            if (!razorMethod) razorMethod = m || "failed";
                            if (!m) {
                                // Try sequence-level razor
                                var sm = razorAt(seq, startTime);
                                log("Track razor failed, seq razor: " + (sm || "also failed"));
                            }
                        }
                        if (endTime > cs + 0.001 && endTime < ce - 0.001) {
                            var m2 = trackRazorAt(track, endTime);
                            if (!m2) razorAt(seq, endTime);
                        }
                    }
                }
            }

            // --- Razor video tracks ---
            for (var v = 0; v < seq.videoTracks.numTracks; v++) {
                var vt = seq.videoTracks[v];
                for (var vc = vt.clips.numItems - 1; vc >= 0; vc--) {
                    var vclip = vt.clips[vc];
                    var vcs = parseFloat(vclip.start.seconds);
                    var vce = parseFloat(vclip.end.seconds);
                    if (vcs < endTime && vce > startTime) {
                        if (startTime > vcs + 0.001 && startTime < vce - 0.001) trackRazorAt(vt, startTime);
                        if (endTime   > vcs + 0.001 && endTime   < vce - 0.001) trackRazorAt(vt, endTime);
                    }
                }
            }

            // --- Select clips in the silence region ---
            for (var t = 0; t < trackIndices.length; t++) {
                var tidx = trackIndices[t];
                if (tidx >= seq.audioTracks.numTracks) continue;
                var track = seq.audioTracks[tidx];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var clip = track.clips[c];
                    var cs = parseFloat(clip.start.seconds);
                    var ce = parseFloat(clip.end.seconds);
                    if (cs >= startTime - 0.01 && ce <= endTime + 0.01) {
                        try { clip.setSelected(true, true); } catch (se) {}
                    }
                }
            }

            for (var v = 0; v < seq.videoTracks.numTracks; v++) {
                var vt = seq.videoTracks[v];
                for (var vc = 0; vc < vt.clips.numItems; vc++) {
                    var vclip = vt.clips[vc];
                    var vcs = parseFloat(vclip.start.seconds);
                    var vce = parseFloat(vclip.end.seconds);
                    if (vcs >= startTime - 0.01 && vce <= endTime + 0.01) {
                        try { vclip.setSelected(true, true); } catch (se) {}
                    }
                }
            }

            // --- Ripple delete ---
            if (hasQE && qeSeq) {
                try {
                    qeSeq.rippleDeleteSelection();
                    deletedCount++;
                    log("  QE ripple delete OK");
                } catch (qeDelErr) {
                    log("  QE ripple delete failed: " + qeDelErr.toString());
                    // Fallback: remove selected clips without ripple
                    deletedCount += removeSelected(seq, trackIndices, startTime, endTime);
                }
            } else {
                deletedCount += removeSelected(seq, trackIndices, startTime, endTime);
            }
        }

        log("Razor method: " + (razorMethod || "not needed"));
        log("Total deleted: " + deletedCount);
        return result({ deletedCount: deletedCount });
    } catch (e) {
        return error("rippleDeleteSilentRegions: " + e.toString());
    }
}

function removeSelected(seq, trackIndices, startTime, endTime) {
    var n = 0;
    for (var t = 0; t < trackIndices.length; t++) {
        var tidx = trackIndices[t];
        if (tidx >= seq.audioTracks.numTracks) continue;
        var track = seq.audioTracks[tidx];
        for (var c = track.clips.numItems - 1; c >= 0; c--) {
            var clip = track.clips[c];
            var cs = parseFloat(clip.start.seconds);
            var ce = parseFloat(clip.end.seconds);
            if (cs >= startTime - 0.01 && ce <= endTime + 0.01) {
                try { clip.remove(true, true); n++; } catch (re) { log("remove() failed: " + re.toString()); }
            }
        }
    }
    for (var v = 0; v < seq.videoTracks.numTracks; v++) {
        var vt = seq.videoTracks[v];
        for (var vc = vt.clips.numItems - 1; vc >= 0; vc--) {
            var vclip = vt.clips[vc];
            var vcs = parseFloat(vclip.start.seconds);
            var vce = parseFloat(vclip.end.seconds);
            if (vcs >= startTime - 0.01 && vce <= endTime + 0.01) {
                try { vclip.remove(true, true); } catch (re) {}
            }
        }
    }
    return n;
}

// ============================================================
// CLEAR MARKERS
// ============================================================

function clearSilenceMarkers() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");

        var markers = seq.markers;
        var toRemove = [];
        var m = markers.getFirstMarker();
        while (m) {
            if (m.name === "Silence") toRemove.push(m);
            m = markers.getNextMarker(m);
        }
        for (var i = 0; i < toRemove.length; i++) markers.deleteMarker(toRemove[i]);

        log("Cleared " + toRemove.length + " markers");
        return result({ removed: toRemove.length });
    } catch (e) {
        return error("clearSilenceMarkers: " + e.toString());
    }
}

// ============================================================
// MISC
// ============================================================

function getExtensionPath() {
    try {
        var f = new File($.fileName);
        return result({ path: f.parent.parent.fsName });
    } catch (e) {
        return error("getExtensionPath: " + e.toString());
    }
}

function getFFmpegPath() {
    try {
        var isWin = ($.os.indexOf("Windows") !== -1);
        var exe = isWin ? "ffmpeg.exe" : "ffmpeg";
        return result({ path: exe, source: "path" });
    } catch (e) {
        return error("getFFmpegPath: " + e.toString());
    }
}
