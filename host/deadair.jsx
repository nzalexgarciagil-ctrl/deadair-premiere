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

        var fps = getFps(seq);
        var frameDuration = 1 / fps;

        // Width / height
        var width = 0, height = 0;
        try { width = seq.width; height = seq.height; } catch (e) {}

        // Duration in seconds
        var durationSecs = 0;
        try { durationSecs = getSeconds(seq.end); } catch (e) {}

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

        return result({
            name:          seq.name,
            fps:           fps,
            frameDuration: frameDuration,
            width:         width,
            height:        height,
            durationSecs:  durationSecs,
            audioTracks:   audioTracks,
            videoTracks:   videoTracks
        });
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
                m.duration = regions[i].end - regions[i].start;
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

    // ── PHASE 1: Delete ALL silence clips across ALL ranges (no ripple) ────────
    // Process right-to-left so index shifts from remove() affect only already-
    // processed (rightward) clips, not the ones we still need to find.
    var reversedRanges = merged.slice().sort(function (a, b) { return b.start - a.start; });
    var totalDeleted = 0;

    for (var rri = 0; rri < reversedRanges.length; rri++) {
        var rng = reversedRanges[rri];
        var rangeDeleted = 0;

        var seqRef = app.project.activeSequence;
        if (!seqRef) { log("Lost sequence at range " + rri); break; }
        var numVT = seqRef.videoTracks.numTracks;
        var numAT = seqRef.audioTracks.numTracks;

        // Video clips
        for (var vt = 0; vt < numVT; vt++) {
            for (var vpass = 0; vpass < 20; vpass++) {
                seqRef = app.project.activeSequence;
                if (!seqRef) break;
                var vtrack = seqRef.videoTracks[vt];
                if (!vtrack || vtrack.clips.numItems === 0) break;
                var vfound = -1;
                for (var vsci = vtrack.clips.numItems - 1; vsci >= 0; vsci--) {
                    var vsc = vtrack.clips[vsci];
                    var vMid = (getSeconds(vsc.start) + getSeconds(vsc.end)) / 2;
                    if (vMid >= rng.start && vMid <= rng.end) { vfound = vsci; break; }
                }
                if (vfound < 0) break;
                seqRef = app.project.activeSequence;
                vtrack = seqRef.videoTracks[vt];
                var vcRef = vtrack.clips[vfound];
                var vcS = getSeconds(vcRef.start), vcE = getSeconds(vcRef.end);
                if (mode === "disable") {
                    try { vcRef.disabled = true; rangeDeleted++; log("  DIS video[" + vt + "] " + vcS.toFixed(2) + "-" + vcE.toFixed(2)); } catch (de) { break; }
                } else {
                    try {
                        vcRef.remove(false, false);
                        rangeDeleted++; totalDeleted++;
                        log("  DEL video[" + vt + "][" + vfound + "] " + vcS.toFixed(2) + "-" + vcE.toFixed(2));
                    } catch (de) { log("  DEL ERR video: " + de); break; }
                }
            }
        }

        // Audio clips
        for (var at = 0; at < numAT; at++) {
            for (var apass = 0; apass < 20; apass++) {
                seqRef = app.project.activeSequence;
                if (!seqRef) break;
                var atrack = seqRef.audioTracks[at];
                if (!atrack || atrack.clips.numItems === 0) break;
                var afound = -1;
                for (var asci = atrack.clips.numItems - 1; asci >= 0; asci--) {
                    var asc = atrack.clips[asci];
                    var aMid = (getSeconds(asc.start) + getSeconds(asc.end)) / 2;
                    if (aMid >= rng.start && aMid <= rng.end) { afound = asci; break; }
                }
                if (afound < 0) break;
                seqRef = app.project.activeSequence;
                atrack = seqRef.audioTracks[at];
                var acRef = atrack.clips[afound];
                var acS = getSeconds(acRef.start), acE = getSeconds(acRef.end);
                if (mode === "disable") {
                    try { acRef.disabled = true; rangeDeleted++; log("  DIS audio[" + at + "] " + acS.toFixed(2) + "-" + acE.toFixed(2)); } catch (de) { break; }
                } else {
                    try {
                        acRef.remove(false, false);
                        rangeDeleted++; totalDeleted++;
                        log("  DEL audio[" + at + "][" + afound + "] " + acS.toFixed(2) + "-" + acE.toFixed(2));
                    } catch (de) { log("  DEL ERR audio: " + de); break; }
                }
            }
        }

        log("Range " + rri + " (" + rng.start.toFixed(2) + "-" + rng.end.toFixed(2) + "s): " + rangeDeleted + " del");
    }

    log("All deletions done. totalDeleted=" + totalDeleted);

    // ── PHASE 2: Single cursor sweep — close ALL gaps on every track at once ──
    // Because audio and video both had clips deleted at the same positions,
    // the same cursor logic applied independently to each track produces
    // identical offsets → audio and video stay perfectly in sync.
    if (mode === "ripple" && totalDeleted > 0) {
        var seqG = app.project.activeSequence;
        if (seqG) {
            var totalMoved = 0;

            // Video tracks
            for (var gvt = 0; gvt < seqG.videoTracks.numTracks; gvt++) {
                seqG = app.project.activeSequence;
                var gvtr = seqG.videoTracks[gvt];
                if (!gvtr || gvtr.clips.numItems === 0) continue;
                // Snapshot: capture object refs + positions before touching anything
                var vitems = [];
                for (var gvci = 0; gvci < gvtr.clips.numItems; gvci++) {
                    var gvc = gvtr.clips[gvci];
                    vitems.push({ obj: gvc, start: getSeconds(gvc.start), dur: getSeconds(gvc.duration) });
                }
                vitems.sort(function (a, b) { return a.start - b.start; });
                var vcursor = 0;
                for (var gvii = 0; gvii < vitems.length; gvii++) {
                    var vgap = vitems[gvii].start - vcursor;
                    if (vgap > (0.4 / fps)) { // < 1 frame at actual sequence fps
                        try { vitems[gvii].obj.move(-vgap); totalMoved++; } catch (me) {}
                    }
                    vcursor += vitems[gvii].dur;
                }
            }

            // Audio tracks
            for (var gat = 0; gat < seqG.audioTracks.numTracks; gat++) {
                seqG = app.project.activeSequence;
                var gatr = seqG.audioTracks[gat];
                if (!gatr || gatr.clips.numItems === 0) continue;
                var aitems = [];
                for (var gaci = 0; gaci < gatr.clips.numItems; gaci++) {
                    var gac = gatr.clips[gaci];
                    aitems.push({ obj: gac, start: getSeconds(gac.start), dur: getSeconds(gac.duration) });
                }
                aitems.sort(function (a, b) { return a.start - b.start; });
                var acursor = 0;
                for (var gaii = 0; gaii < aitems.length; gaii++) {
                    var agap = aitems[gaii].start - acursor;
                    if (agap > (0.4 / fps)) { // < 1 frame at actual sequence fps
                        try { aitems[gaii].obj.move(-agap); totalMoved++; } catch (me) {}
                    }
                    acursor += aitems[gaii].dur;
                }
            }

            log("Gap sweep done: " + totalMoved + " clips moved");
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
