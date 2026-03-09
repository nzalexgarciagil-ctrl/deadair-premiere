/**
 * DeadAir - Silence Remover for Adobe Premiere Pro
 * ExtendScript backend — razor/delete logic ported from kinokit's removeTimeRanges
 * MIT License
 */

var TICKS_PER_SECOND = 254016000000;

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

var _logs = [];
function log(msg) { _logs.push(String(msg)); $.writeln("[DeadAir] " + msg); }

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

function secondsToTicks(secs) {
    return String(Math.round(parseFloat(secs) * TICKS_PER_SECOND));
}

function getSeconds(timeObj) {
    if (!timeObj) return 0;
    if (typeof timeObj.seconds === "number" && !isNaN(timeObj.seconds)) return timeObj.seconds;
    if (timeObj.ticks !== undefined) return parseFloat(timeObj.ticks) / TICKS_PER_SECOND;
    return 0;
}

function secsToTC(totalSecs, fps) {
    totalSecs = parseFloat(totalSecs);
    if (isNaN(totalSecs) || totalSecs < 0) totalSecs = 0;
    var h = Math.floor(totalSecs / 3600);
    var m = Math.floor((totalSecs % 3600) / 60);
    var s = Math.floor(totalSecs % 60);
    var f = Math.floor((totalSecs - Math.floor(totalSecs)) * fps);
    if (f >= fps) f = Math.floor(fps) - 1;
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return p(h) + ":" + p(m) + ":" + p(s) + ":" + p(f);
}

function countClips(seq) {
    var n = 0;
    for (var i = 0; i < seq.videoTracks.numTracks; i++) n += seq.videoTracks[i].clips.numItems;
    for (var j = 0; j < seq.audioTracks.numTracks; j++) n += seq.audioTracks[j].clips.numItems;
    return n;
}

function getFps(seq) {
    var fps = 24;
    try {
        if (seq.videoFrameRate && seq.videoFrameRate.ticks) {
            var tpf = parseInt(seq.videoFrameRate.ticks, 10);
            if (tpf > 0) fps = Math.round(TICKS_PER_SECOND / tpf * 100) / 100;
        }
        if (isNaN(fps) || fps <= 0) {
            var tb = parseInt(seq.timebase, 10);
            if (tb > 0) fps = Math.round(TICKS_PER_SECOND / tb * 100) / 100;
        }
    } catch (e) {}
    if (isNaN(fps) || fps <= 0) fps = 24;
    return fps;
}

// ============================================================
// GET SEQUENCE INFO
// ============================================================

function getSequenceInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");
        var audioTracks = [];
        for (var i = 0; i < seq.audioTracks.numTracks; i++) {
            var t = seq.audioTracks[i];
            audioTracks.push({ index: i, name: t.name, clipCount: t.clips.numItems });
        }
        var videoTracks = [];
        for (var i = 0; i < seq.videoTracks.numTracks; i++) {
            var t = seq.videoTracks[i];
            videoTracks.push({ index: i, name: t.name, clipCount: t.clips.numItems });
        }
        return result({ name: seq.name, audioTracks: audioTracks, videoTracks: videoTracks });
    } catch (e) { return error("getSequenceInfo: " + e.toString()); }
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
            var tidx = trackIndices[t];
            if (tidx < 0 || tidx >= seq.audioTracks.numTracks) continue;
            var track = seq.audioTracks[tidx];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var mediaPath = "";
                try { if (clip.projectItem) mediaPath = clip.projectItem.getMediaPath(); } catch (pe) {}
                clips.push({
                    trackIndex: tidx, clipIndex: c, name: clip.name,
                    startSeconds:    getSeconds(clip.start),
                    endSeconds:      getSeconds(clip.end),
                    inPointSeconds:  getSeconds(clip.inPoint),
                    outPointSeconds: getSeconds(clip.outPoint),
                    durationSeconds: getSeconds(clip.duration),
                    mediaPath: mediaPath
                });
            }
        }
        log("Returning " + clips.length + " clips");
        return result(clips);
    } catch (e) { return error("getClipMediaPaths: " + e.toString()); }
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
            try {
                var m = seq.markers.createMarker(regions[i].start);
                m.name = "Silence";
                m.comments = "Duration: " + (regions[i].end - regions[i].start).toFixed(2) + "s";
                m.setTypeAsComment();
                count++;
            } catch (me) { log("Marker " + i + " failed: " + me.toString()); }
        }
        log("Added " + count + " markers");
        return result({ markersAdded: count });
    } catch (e) { return error("addSilenceMarkers: " + e.toString()); }
}

// ============================================================
// DISABLE SILENT REGIONS (non-destructive)
// ============================================================

function disableSilentRegions(regionsStr, trackIndicesStr) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");
        var regions = jsonParse(regionsStr);
        var trackIndices = jsonParse(trackIndicesStr);
        var disabledCount = removeTimeRangesCore(seq, regions, trackIndices, "disable");
        return result({ disabledCount: disabledCount });
    } catch (e) { return error("disableSilentRegions: " + e.toString()); }
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
        var deletedCount = removeTimeRangesCore(seq, regions, trackIndices, "ripple");
        return result({ deletedCount: deletedCount });
    } catch (e) { return error("rippleDeleteSilentRegions: " + e.toString()); }
}

// ============================================================
// CORE: RAZOR → DELETE → GAP CLOSE  (kinokit's proven approach)
// ============================================================

function removeTimeRangesCore(seq, ranges, trackIndices, mode) {
    log("removeTimeRangesCore: " + ranges.length + " ranges, mode=" + mode);

    // Sort and merge overlapping ranges
    ranges.sort(function (a, b) { return a.start - b.start; });
    var merged = [{ start: parseFloat(ranges[0].start), end: parseFloat(ranges[0].end) }];
    for (var mi = 1; mi < ranges.length; mi++) {
        var last = merged[merged.length - 1];
        var rs = parseFloat(ranges[mi].start), re = parseFloat(ranges[mi].end);
        if (rs <= last.end + 0.02) { last.end = Math.max(last.end, re); }
        else { merged.push({ start: rs, end: re }); }
    }
    log("Merged to " + merged.length + " ranges");

    // ── Enable QE DOM ──────────────────────────────────────
    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();
    if (!qeSeq) { log("WARN: QE DOM unavailable — skipping razor"); return 0; }
    log("QE DOM available");

    var fps = getFps(seq);
    log("FPS=" + fps);

    // ── Collect all unique cut times ──────────────────────
    var cutTimes = [];
    for (var ci = 0; ci < merged.length; ci++) {
        if (merged[ci].start > 0.01) cutTimes.push(merged[ci].start);
        cutTimes.push(merged[ci].end);
    }
    cutTimes.sort(function (a, b) { return a - b; });
    var unique = [cutTimes[0]];
    for (var ui = 1; ui < cutTimes.length; ui++) {
        if (Math.abs(cutTimes[ui] - unique[unique.length - 1]) > 0.01) unique.push(cutTimes[ui]);
    }
    cutTimes = unique;
    log("Cut times: " + cutTimes.length);

    // ── Discover working razor method ─────────────────────
    // Find a test time that's inside an actual clip (not at a boundary)
    var testTime = null, testIdx = -1;
    for (var tti = 0; tti < cutTimes.length && testTime === null; tti++) {
        var cand = cutTimes[tti];
        if (cand < 0.05) continue;
        var seqNow = app.project.activeSequence;
        outer: for (var vt = 0; vt < seqNow.videoTracks.numTracks; vt++) {
            var vtr = seqNow.videoTracks[vt];
            for (var vc = 0; vc < vtr.clips.numItems; vc++) {
                var vcl = vtr.clips[vc];
                var vs = getSeconds(vcl.start), ve = getSeconds(vcl.end);
                if (cand > vs + 0.05 && cand < ve - 0.05) { testTime = cand; testIdx = tti; break outer; }
            }
        }
        if (testTime === null) {
            outer2: for (var at = 0; at < seqNow.audioTracks.numTracks; at++) {
                var atr = seqNow.audioTracks[at];
                for (var ac = 0; ac < atr.clips.numItems; ac++) {
                    var acl = atr.clips[ac];
                    var as = getSeconds(acl.start), ae = getSeconds(acl.end);
                    if (cand > as + 0.05 && cand < ae - 0.05) { testTime = cand; testIdx = tti; break outer2; }
                }
            }
        }
    }

    if (testTime === null) {
        log("ERROR: No cut times fall inside clips. Timeline may have shifted.");
        return 0;
    }
    log("Test cut at " + testTime.toFixed(3) + "s");

    var clipsBefore = countClips(app.project.activeSequence);
    log("Clips before razor: " + clipsBefore);

    // Candidates: try TC, ticks, secs on both razor and razorAt
    var candidates = [
        { fn: "razor",   arg: secsToTC(testTime, fps),      desc: "razor(TC)" },
        { fn: "razor",   arg: secondsToTicks(testTime),      desc: "razor(ticks)" },
        { fn: "razor",   arg: String(testTime),              desc: "razor(secs)" },
        { fn: "razorAt", arg: secsToTC(testTime, fps),      desc: "razorAt(TC)" },
        { fn: "razorAt", arg: secondsToTicks(testTime),      desc: "razorAt(ticks)" },
        { fn: "razorAt", arg: String(testTime),              desc: "razorAt(secs)" }
    ];

    var workingMethod = null;
    for (var cmi = 0; cmi < candidates.length; cmi++) {
        var cm = candidates[cmi];
        if (typeof qeSeq[cm.fn] !== "function") { log(cm.desc + ": not a function"); continue; }
        try { qeSeq[cm.fn](cm.arg); } catch (e) { log(cm.desc + ": threw " + e); continue; }
        var clipsNow = countClips(app.project.activeSequence);
        if (clipsNow > clipsBefore) {
            workingMethod = cm;
            log(cm.desc + ": WORKS (" + clipsBefore + " -> " + clipsNow + " clips)");
            clipsBefore = clipsNow;
            break;
        } else {
            log(cm.desc + ": no effect (still " + clipsNow + ")");
        }
    }

    if (!workingMethod) {
        log("ERROR: No razor method worked. Sequence may have no clips at cut times.");
        return 0;
    }

    // ── Apply razor to all remaining cut times ────────────
    app.enableQE();
    qeSeq = qe.project.getActiveSequence();

    for (var ri = 0; ri < cutTimes.length; ri++) {
        if (ri === testIdx) continue; // already cut during discovery
        var arg;
        if (workingMethod.desc.indexOf("TC") !== -1) arg = secsToTC(cutTimes[ri], fps);
        else if (workingMethod.desc.indexOf("ticks") !== -1) arg = secondsToTicks(cutTimes[ri]);
        else arg = String(cutTimes[ri]);
        try { qeSeq[workingMethod.fn](arg); } catch (e) { log("Razor at " + cutTimes[ri].toFixed(3) + "s failed: " + e); }
    }

    var clipsAfterRazor = countClips(app.project.activeSequence);
    log("After razor: " + clipsAfterRazor + " clips");

    // ── Delete or disable clips in ranges (reverse order) ─
    var reversedRanges = merged.slice().sort(function (a, b) { return b.start - a.start; });
    var totalDeleted = 0;
    var modifiedVideoTracks = {}, modifiedAudioTracks = {};

    for (var rri = 0; rri < reversedRanges.length; rri++) {
        var rng = reversedRanges[rri];
        var rangeDeleted = 0;

        // Build track list
        var seqRef = app.project.activeSequence;
        if (!seqRef) { log("Lost sequence at range " + rri); break; }

        var trackList = [];
        for (var tvl = 0; tvl < seqRef.videoTracks.numTracks; tvl++) trackList.push({ type: "video", idx: tvl });
        for (var tal = 0; tal < seqRef.audioTracks.numTracks; tal++) trackList.push({ type: "audio", idx: tal });

        for (var tli = 0; tli < trackList.length; tli++) {
            var tinfo = trackList[tli];
            for (var pass = 0; pass < 20; pass++) {
                // Re-fetch sequence and track fresh every pass
                seqRef = app.project.activeSequence;
                if (!seqRef) break;
                var track = (tinfo.type === "video") ? seqRef.videoTracks[tinfo.idx] : seqRef.audioTracks[tinfo.idx];
                if (!track || track.clips.numItems === 0) break;

                // Find clip whose MIDPOINT is inside this range
                var foundIdx = -1;
                for (var sci = track.clips.numItems - 1; sci >= 0; sci--) {
                    var sc = track.clips[sci];
                    var scMid = (getSeconds(sc.start) + getSeconds(sc.end)) / 2;
                    if (scMid >= rng.start && scMid <= rng.end) { foundIdx = sci; break; }
                }
                if (foundIdx < 0) break;

                // Re-fetch clip reference immediately before operation
                seqRef = app.project.activeSequence;
                track = (tinfo.type === "video") ? seqRef.videoTracks[tinfo.idx] : seqRef.audioTracks[tinfo.idx];
                var clipRef = track.clips[foundIdx];
                var cStart = getSeconds(clipRef.start), cEnd = getSeconds(clipRef.end);
                var clipsBefore2 = track.clips.numItems;

                if (mode === "disable") {
                    try {
                        clipRef.disabled = true;
                        rangeDeleted++;
                        log("  DISABLE " + tinfo.type + "[" + tinfo.idx + "][" + foundIdx + "] " + cStart.toFixed(2) + "-" + cEnd.toFixed(2));
                    } catch (de) { log("  DISABLE ERR: " + de); break; }
                } else {
                    // Ripple delete: remove(ripple=true, deleteFromProject=false)
                    try {
                        clipRef.remove(true, false);
                    } catch (de) {
                        log("  DEL ERR: " + de);
                        try { track.clips[foundIdx].remove(false, false); } catch (e2) {}
                        break;
                    }
                    var clipsAfter2 = track.clips.numItems;
                    if (clipsAfter2 < clipsBefore2) {
                        rangeDeleted++;
                        totalDeleted++;
                        if (tinfo.type === "video") modifiedVideoTracks[tinfo.idx] = true;
                        else modifiedAudioTracks[tinfo.idx] = true;
                        log("  DEL " + tinfo.type + "[" + tinfo.idx + "][" + foundIdx + "] " + cStart.toFixed(2) + "-" + cEnd.toFixed(2));
                    } else {
                        // remove() had no effect — try without ripple
                        log("  WARN remove(true) no effect, trying remove(false)");
                        try {
                            seqRef = app.project.activeSequence;
                            track = (tinfo.type === "video") ? seqRef.videoTracks[tinfo.idx] : seqRef.audioTracks[tinfo.idx];
                            if (track && track.clips.numItems > foundIdx) {
                                track.clips[foundIdx].remove(false, false);
                                if (track.clips.numItems < clipsBefore2) {
                                    rangeDeleted++;
                                    totalDeleted++;
                                }
                            }
                        } catch (e2) { log("  FAIL fallback: " + e2); break; }
                    }
                }
            }
        }
        log("Range " + rri + " (" + rng.start.toFixed(2) + "-" + rng.end.toFixed(2) + "s): " + rangeDeleted + " ops");
    }

    // ── Close gaps on modified tracks (ripple mode only) ──
    if (mode === "ripple") {
        seqRef = app.project.activeSequence;
        if (seqRef) {
            var gapsFixed = 0;
            function closeGapsOnTrack(clips) {
                // Build sorted clip list and move each clip to close gaps
                var sorted = [];
                for (var ci = 0; ci < clips.numItems; ci++) sorted.push(ci);
                sorted.sort(function (a, b) { return getSeconds(clips[a].start) - getSeconds(clips[b].start); });

                var cursor = 0;
                for (var si = 0; si < sorted.length; si++) {
                    seqRef = app.project.activeSequence;
                    var expectedStart = cursor;
                    var c = clips[sorted[si]];
                    var cStart = getSeconds(c.start);
                    var cDur = getSeconds(c.duration);
                    if (cStart - expectedStart > 0.02) {
                        try {
                            c.move(expectedStart - cStart);
                            gapsFixed++;
                        } catch (me) {}
                    }
                    cursor = expectedStart + cDur;
                }
            }

            for (var gvt = 0; gvt < seqRef.videoTracks.numTracks; gvt++) {
                if (!modifiedVideoTracks[gvt]) continue;
                try { closeGapsOnTrack(seqRef.videoTracks[gvt].clips); } catch (e) {}
            }
            for (var gat = 0; gat < seqRef.audioTracks.numTracks; gat++) {
                if (!modifiedAudioTracks[gat]) continue;
                try { closeGapsOnTrack(seqRef.audioTracks[gat].clips); } catch (e) {}
            }
            if (gapsFixed > 0) log("Closed " + gapsFixed + " gaps");
        }
    }

    log("Done. totalDeleted=" + totalDeleted);
    return totalDeleted;
}

// ============================================================
// CLEAR MARKERS
// ============================================================

function clearSilenceMarkers() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return error("No active sequence.");
        var toRemove = [], m = seq.markers.getFirstMarker();
        while (m) { if (m.name === "Silence") toRemove.push(m); m = seq.markers.getNextMarker(m); }
        for (var i = 0; i < toRemove.length; i++) seq.markers.deleteMarker(toRemove[i]);
        log("Cleared " + toRemove.length + " markers");
        return result({ removed: toRemove.length });
    } catch (e) { return error("clearSilenceMarkers: " + e.toString()); }
}

function getExtensionPath() {
    try { return result({ path: new File($.fileName).parent.parent.fsName }); }
    catch (e) { return error("getExtensionPath: " + e.toString()); }
}

function getFFmpegPath() {
    return result({ path: "ffmpeg", source: "path" });
}
