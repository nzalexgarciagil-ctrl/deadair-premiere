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
            result: "clips removed; gaps closed"
        },
        lift: {
            button: "Remove and leave gaps",
            progress: "Removing silence without moving clips...",
            result: "clips removed; timing preserved"
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
        return MODES[mode] || MODES.ripple;
    }

    return {
        THRESHOLD_MIN: THRESHOLD_MIN,
        THRESHOLD_MAX: THRESHOLD_MAX,
        THRESHOLD_DEFAULT: THRESHOLD_DEFAULT,
        normalizeThreshold: normalizeThreshold,
        thresholdToLinear: thresholdToLinear,
        suggestThreshold: suggestThreshold,
        modeInfo: modeInfo
    };
}));
