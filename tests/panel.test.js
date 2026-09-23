const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const root = path.join(__dirname, "..");

function panel(t, settings) {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", error => errors.push(error));
    const dom = new JSDOM(fs.readFileSync(path.join(root, "client/index.html"), "utf8"), {
        url: "https://deadair.test/", runScripts: "outside-only", virtualConsole
    });
    t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
    const { window } = dom;
    window.setTimeout = callback => { callback(); return 1; };
    window.HTMLElement.prototype.scrollIntoView = function () {};
    if (settings) window.localStorage.setItem("deadair_settings", JSON.stringify(settings));
    for (const file of ["tests/fixtures/panel-host.js", "client/core.js", "client/main.js"]) {
        window.eval(fs.readFileSync(path.join(root, file), "utf8"));
    }
    const get = id => window.document.getElementById(id);
    function change(id, value) {
        get(id).value = value;
        get(id).dispatchEvent(new window.Event("change", { bubbles: true }));
    }
    function mode(value) { window.document.querySelector(`input[name="cut-mode"][value="${value}"]`).click(); }
    return { window, get, change, mode, state: window.__panelTest };
}

test("source is visible and old removal preferences do not override marker-first review", t => {
    const p = panel(t, { threshold: -42, minDuration: 1.2, padding: 0, cutMode: "ripple" });
    assert.match(p.get("sequence-name").textContent, /review copy/);
    assert.equal(p.get("threshold-number").value, "-42");
    assert.equal(p.get("duration-number").value, "1.2");
    assert.equal(p.get("padding-number").value, "0");
    assert.equal(p.window.document.querySelector('input[name="cut-mode"]:checked').value, "markers");
    assert.equal(p.get("btn-analyze").disabled, false);
    assert.equal(p.get("multi-track-warning").classList.contains("hidden"), false);
});

test("analysis shows regions, lets users navigate and previews without applying", t => {
    const p = panel(t);
    p.get("btn-analyze").click();
    assert.equal(p.get("region-select").options.length, 2);
    assert.match(p.get("region-count").textContent, /2 regions/);
    assert.match(p.get("total-silence").textContent, /3.6 s/);
    assert.equal(p.get("btn-previous").disabled, true);
    assert.equal(p.get("btn-next").disabled, false);
    assert.equal(p.get("affected-tracks").textContent, "Adds sequence markers. No audio or video clips change.");
    assert.equal(p.get("edit-warning").classList.contains("hidden"), true);
    p.get("btn-next").click();
    assert.equal(p.get("region-select").value, "1");
    assert.equal(p.get("btn-next").disabled, true);
    p.get("btn-preview").click();
    assert.deepEqual(Array.from(p.state.previewPositions), [6.1]);
    assert.equal(p.state.actions.length, 0);
    p.get("btn-previous").click();
    assert.equal(p.get("region-select").value, "0");
});

test("clip edits disclose every affected track and require acknowledgement", t => {
    const p = panel(t);
    p.get("btn-analyze").click();
    p.mode("ripple");
    assert.equal(p.get("btn-execute").disabled, true);
    assert.match(p.get("affected-tracks").textContent, /V1 Camera, V2 B-roll, A1 Dialogue/);
    assert.match(p.get("edit-warning").textContent, /existing gaps/);
    assert.match(p.get("timing-summary").textContent, /shorten by more/);
    p.get("btn-execute").click();
    assert.equal(p.state.actions.length, 0);
    p.get("confirm-edit").click();
    assert.equal(p.get("btn-execute").disabled, false);
    p.mode("lift");
    assert.equal(p.get("confirm-edit").checked, false);
    assert.equal(p.get("btn-execute").disabled, true);
    p.get("confirm-edit").click();
    p.get("btn-execute").click();
    assert.equal(p.state.actions[0][2], "lift");
    assert.equal(p.state.actions[0][3], "test-sequence");
    assert.equal(p.get("results").classList.contains("hidden"), true);
});

test("marker apply never needs clip-edit acknowledgement", t => {
    const p = panel(t);
    p.get("btn-analyze").click();
    p.get("btn-execute").click();
    assert.equal(p.state.actions[0][2], "markers");
    assert.match(p.get("status-text").textContent, /2 markers added/);
});

test("detection settings clamp values, synchronize inputs and invalidate results", t => {
    const p = panel(t);
    p.get("btn-analyze").click();
    p.change("duration-number", "9");
    assert.equal(p.get("duration-number").value, "5");
    assert.equal(p.get("min-duration").value, "5");
    assert.equal(p.get("results").classList.contains("hidden"), true);
    assert.match(p.get("status-text").textContent, /Detection changed/);
    p.change("padding-number", "127");
    assert.equal(p.get("padding").value, "130");
    p.change("threshold-number", "-999");
    assert.equal(p.get("threshold").value, "-100");
    p.change("duration-number", "");
    assert.equal(p.get("min-duration").value, "0.8");
});

test("source changes and refresh discard previous results", t => {
    const p = panel(t);
    p.get("btn-analyze").click();
    p.change("track-select", "0");
    assert.equal(p.get("results").classList.contains("hidden"), true);
    assert.equal(p.get("multi-track-warning").classList.contains("hidden"), true);
    p.get("btn-analyze").click();
    p.state.sequence.name = "Another sequence";
    p.state.sequence.sequenceID = "another-sequence";
    p.get("btn-refresh").click();
    assert.equal(p.get("results").classList.contains("hidden"), true);
    assert.equal(p.get("sequence-name").textContent, "Another sequence");
});

test("controls are disabled throughout asynchronous audio analysis", t => {
    const p = panel(t);
    p.state.holdAudio = true;
    p.get("btn-analyze").click();
    for (const id of ["btn-analyze", "btn-auto", "btn-refresh", "threshold-number", "track-select", "btn-clear-markers"]) {
        assert.equal(p.get(id).disabled, true, id);
    }
    p.state.pendingAudio();
    assert.equal(p.get("btn-analyze").disabled, false);
    assert.equal(p.get("btn-preview").disabled, false);
});

test("sequence switches reject preview and apply without hiding the failure", t => {
    const p = panel(t);
    p.get("btn-analyze").click();
    p.state.sequence.sequenceID = "different-sequence";
    p.get("btn-preview").click();
    assert.match(p.get("status-text").textContent, /active sequence changed/);
    p.get("btn-execute").click();
    assert.equal(p.state.actions.length, 0);
    assert.equal(p.state.previewPositions.length, 0);
    assert.match(p.get("status-text").textContent, /active sequence changed/);
});

test("missing media produces recovery guidance and leaves apply unavailable", t => {
    const p = panel(t);
    p.state.missingMedia = true;
    p.get("btn-analyze").click();
    assert.match(p.get("status-text").textContent, /Could not read any audio/);
    assert.match(p.get("status-text").textContent, /FFmpeg/);
    assert.equal(p.get("btn-analyze").disabled, false);
    assert.equal(p.get("btn-execute").disabled, true);
});

test("no quiet sections leaves the panel ready for another analysis", t => {
    const p = panel(t);
    p.state.noQuiet = true;
    p.get("btn-analyze").click();
    assert.match(p.get("status-text").textContent, /No quiet sections found/);
    assert.equal(p.get("btn-analyze").disabled, false);
    assert.equal(p.get("results").classList.contains("hidden"), true);
});

test("no sequence disables analysis and explains how to reconnect", t => {
    const p = panel(t);
    p.state.sequence = null;
    p.get("btn-refresh").click();
    assert.equal(p.get("btn-analyze").disabled, true);
    assert.equal(p.get("btn-auto").disabled, true);
    assert.match(p.get("sequence-detail").textContent, /Open a sequence/);
});

test("clearing markers requires informed confirmation", t => {
    const p = panel(t);
    p.get("btn-clear-markers").click();
    assert.equal(p.state.calls.some(call => call.startsWith("clearSilenceMarkers")), false);
    assert.match(p.state.confirmations[0], /not created by DeadAir/);
    p.state.confirmResult = true;
    p.get("btn-clear-markers").click();
    assert.equal(p.state.calls.some(call => call.startsWith("clearSilenceMarkers")), true);
});

test("all visible controls have accessible names and status remains a live region", t => {
    const p = panel(t);
    for (const input of p.window.document.querySelectorAll("input, select")) {
        const label = input.getAttribute("aria-label") || input.closest("label") || p.window.document.querySelector(`label[for="${input.id}"]`);
        assert.ok(label, input.id || input.name);
    }
    assert.equal(p.get("status-bar").getAttribute("role"), "status");
    assert.equal(p.get("status-bar").getAttribute("aria-live"), "polite");
    p.get("btn-toggle-log").click();
    assert.equal(p.get("btn-toggle-log").getAttribute("aria-expanded"), "true");
});
