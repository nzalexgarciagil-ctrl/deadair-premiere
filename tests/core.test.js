const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../client/core.js");

test("core is exposed to the panel when CEP also provides CommonJS globals", () => {
    const context = { module: { exports: {} } };
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, "..", "client", "core.js"), "utf8"),
        context
    );

    assert.equal(typeof context.DeadAirCore.normalizeThreshold, "function");
    assert.equal(context.module.exports, context.DeadAirCore);
});

test("manual thresholds extend down to -100 dB", () => {
    assert.equal(core.normalizeThreshold(-100), -100);
    assert.equal(core.normalizeThreshold(-120), -100);
    assert.equal(core.normalizeThreshold(-9), -10);
    assert.equal(core.normalizeThreshold("invalid"), -35);
    assert.equal(core.thresholdToLinear(-100), 0.00001);
});

test("auto detection can recommend a threshold below -60 dB", () => {
    const samples = [];
    for (let i = 0; i < 70; i += 1) samples.push(-90);
    for (let i = 0; i < 30; i += 1) samples.push(-30);

    const result = core.suggestThreshold(samples);

    assert.equal(result.noiseFloor, -90);
    assert.equal(result.speechLevel, -30);
    assert.equal(result.threshold, -72);
});

test("timeline action labels distinguish ripple and non-ripple deletion", () => {
    assert.equal(core.modeInfo("ripple").button, "Remove and close gaps");
    assert.equal(core.modeInfo("lift").button, "Remove and leave gaps");
    assert.match(core.modeInfo("lift").result, /timing preserved/);
});

test("unknown modes use marker review rather than destructive removal", () => {
    assert.equal(core.modeInfo("unknown").button, "Add silence markers");
});

test("numeric controls clamp, round to steps and retain zero padding", () => {
    assert.equal(core.normalizeSetting("99", 0.1, 5, 0.1, 0.8), 5);
    assert.equal(core.normalizeSetting("", 0.1, 5, 0.1, 0.8), 0.8);
    assert.equal(core.normalizeSetting("127", 0, 500, 10, 100), 130);
    assert.equal(core.normalizeSetting("0", 0, 500, 10, 100), 0);
});

test("review positions handle minute and hour boundaries without 60-second output", () => {
    assert.equal(core.formatPosition(1.1), "00:01.1");
    assert.equal(core.formatPosition(59.99), "01:00.0");
    assert.equal(core.formatPosition(3600), "1:00:00.0");
    assert.equal(core.formatDuration(59.99), "1 min 0.0 s");
    assert.equal(core.regionLabel({ start: 1.1, end: 2.9 }), "00:01.1 to 00:02.9 (1.8 s)");
});

test("edit scope lists populated video and audio tracks, not just analysis audio", () => {
    const sequence = {
        videoTracks: [{ index: 0, name: "Camera", clipCount: 1 }],
        audioTracks: [{ index: 0, name: "Dialogue", clipCount: 1 }, { index: 1, name: "Empty", clipCount: 0 }]
    };
    assert.match(core.affectedTracksText("lift", sequence), /V1 Camera, A1 Dialogue/);
    assert.doesNotMatch(core.affectedTracksText("lift", sequence), /Empty/);
    assert.match(core.affectedTracksText("markers", sequence), /No audio or video clips change/);
    assert.match(core.timingText("ripple", 5), /existing gaps also close/);
    assert.equal(core.timingText("lift", 5), "Sequence timing stays unchanged.");
});
