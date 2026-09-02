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
