(function (root, factory) {
    "use strict";

    var api = factory();
    root.DeadAirCore = api;
    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }
}(this, function () {
    "use strict";

    var THRESHOLD_MIN = -100;
    var THRESHOLD_MAX = -10;
    var THRESHOLD_DEFAULT = -35;

    var MODES = {
        ripple: {
            button: "Remove and close gaps",
            progress: "Removing silence and closing gaps...",
            result: "clips removed with gap closing"
        },
        lift: {
            button: "Remove and leave gaps",
            progress: "Removing silence without moving clips...",
            result: "clips removed with timing preserved"
        },
        disable: {
            button: "Disable silent sections",
            progress: "Disabling silent sections...",
            result: "clips disabled"
        },
        markers: {
            button: "Add silence markers",
            progress: "Adding silence markers...",
            result: "markers added"
        }
    };

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizeThreshold(value) {
        var parsed = parseFloat(value);
        if (!isFinite(parsed)) parsed = THRESHOLD_DEFAULT;
        return Math.round(clamp(parsed, THRESHOLD_MIN, THRESHOLD_MAX));
    }

    function thresholdToLinear(value) {
        return Math.pow(10, normalizeThreshold(value) / 20);
    }

    function suggestThreshold(dbValues) {
        if (!dbValues || dbValues.length === 0) return null;
        var sorted = dbValues.slice().sort(function (a, b) { return a - b; });
        var noiseFloor = sorted[Math.floor(sorted.length * 0.05)];
        var speechLevel = sorted[Math.floor(sorted.length * 0.70)];
        var suggested = noiseFloor + (speechLevel - noiseFloor) * 0.30;

        return {
            noiseFloor: noiseFloor,
            speechLevel: speechLevel,
            threshold: Math.round(clamp(suggested, -95, -15))
        };
    }

    function modeInfo(mode) {
        return MODES[mode] || MODES.markers;
    }

    function normalizeSetting(value, min, max, step, fallback) {
        var parsed = parseFloat(value);
        if (!isFinite(parsed)) parsed = fallback;
        return Number((Math.round(clamp(parsed, min, max) / step) * step).toFixed(3));
    }

    function formatDuration(seconds) {
        var tenths = Math.round(Math.max(0, seconds) * 10);
        if (tenths < 600) return (tenths / 10).toFixed(1) + " s";
        return Math.floor(tenths / 600) + " min " + ((tenths % 600) / 10).toFixed(1) + " s";
    }

    function formatPosition(seconds) {
        var tenths = Math.round(Math.max(0, seconds) * 10);
        var hours = Math.floor(tenths / 36000);
        var minutes = Math.floor(tenths / 600) % 60;
        var secs = (tenths % 600) / 10;
        function pad(value) { return value < 10 ? "0" + value : String(value); }
        return (hours ? hours + ":" : "") + pad(minutes) + ":" + pad(secs.toFixed(1));
    }

    function regionLabel(region) {
        return formatPosition(region.start) + " to " + formatPosition(region.end) + " (" + formatDuration(region.end - region.start) + ")";
    }

    function affectedTracksText(mode, sequence) {
        if (mode === "markers") return "Adds sequence markers. No audio or video clips change.";
        if (!sequence) return "Edits affect all video and audio tracks.";
        var tracks = [];
        function add(items, prefix) {
            for (var i = 0; i < items.length; i++) {
                if (items[i].clipCount > 0) tracks.push(prefix + (items[i].index + 1) + " " + items[i].name);
            }
        }
        add(sequence.videoTracks, "V");
        add(sequence.audioTracks, "A");
        return "Edits affect all video and audio tracks: " + tracks.join(", ") + ".";
    }

    function timingText(mode, seconds) {
        if (mode === "ripple") return formatDuration(seconds) + " of quiet audio selected. The sequence can shorten by more because existing gaps also close.";
        return "Sequence timing stays unchanged.";
    }

    return {
        THRESHOLD_MIN: THRESHOLD_MIN,
        THRESHOLD_MAX: THRESHOLD_MAX,
        THRESHOLD_DEFAULT: THRESHOLD_DEFAULT,
        normalizeThreshold: normalizeThreshold,
        thresholdToLinear: thresholdToLinear,
        suggestThreshold: suggestThreshold,
        modeInfo: modeInfo,
        normalizeSetting: normalizeSetting,
        formatDuration: formatDuration,
        formatPosition: formatPosition,
        regionLabel: regionLabel,
        affectedTracksText: affectedTracksText,
        timingText: timingText
    };
}));
