const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const hostSource = fs.readFileSync(
    path.join(__dirname, "..", "host", "deadair.jsx"),
    "utf8"
);

function loadHost(activeSequence = { name: "Test sequence" }, qeSequence = null) {
    const context = {
        $: { writeln() {} },
        app: {
            enableQE() {},
            project: { activeSequence }
        },
        qe: {
            project: { getActiveSequence: () => qeSequence }
        },
        console
    };
    vm.createContext(context);
    vm.runInContext(hostSource, context, { filename: "deadair.jsx" });
    return context;
}

function createTimeline() {
    const activity = { removed: 0, moved: 0 };

    function createCollection(items) {
        const collection = { _items: items };
        collection.sync = function () {
            Object.keys(collection).forEach((key) => {
                if (/^\d+$/.test(key)) delete collection[key];
            });
            collection._items.forEach((item, index) => {
                item._collection = collection;
                collection[index] = item;
            });
        };
        Object.defineProperty(collection, "numItems", {
            get() { return collection._items.length; }
        });
        collection.sync();
        return collection;
    }

    function createClip(start, end) {
        return {
            start: { seconds: start },
            end: { seconds: end },
            duration: { seconds: end - start },
            remove() {
                const index = this._collection._items.indexOf(this);
                this._collection._items.splice(index, 1);
                this._collection.sync();
                activity.removed += 1;
            },
            move(delta) {
                this.start.seconds += delta;
                this.end.seconds += delta;
                activity.moved += 1;
            }
        };
    }

    const videoClips = createCollection([createClip(0, 3)]);
    const audioClips = createCollection([createClip(0, 3)]);
    const videoTracks = { 0: { clips: videoClips }, numTracks: 1 };
    const audioTracks = { 0: { clips: audioClips }, numTracks: 1 };
    const sequence = {
        videoTracks,
        audioTracks,
        videoFrameRate: { ticks: String(254016000000 / 24) }
    };

    function split(collection, time) {
        for (let index = 0; index < collection._items.length; index += 1) {
            const clip = collection._items[index];
            if (time > clip.start.seconds && time < clip.end.seconds) {
                collection._items.splice(
                    index,
                    1,
                    createClip(clip.start.seconds, time),
                    createClip(time, clip.end.seconds)
                );
                collection.sync();
                return;
            }
        }
    }

    const qeSequence = {
        razor(timecode) {
            const parts = timecode.split(":").map(Number);
            const seconds = parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 24;
            split(videoClips, seconds);
            split(audioClips, seconds);
        }
    };

    return { activity, sequence, qeSequence };
}

test("leave-gaps action invokes the shared removal engine in lift mode", () => {
    const host = loadHost();
    let invocation = null;
    host.removeTimeRangesCore = (sequence, regions, tracks, mode) => {
        invocation = { sequence, regions, tracks, mode };
        return 4;
    };

    const response = JSON.parse(host.liftDeleteSilentRegions(
        JSON.stringify([{ start: 1, end: 2 }]),
        JSON.stringify([0, 1])
    ));

    assert.equal(response.success, true);
    assert.equal(response.data.deletedCount, 4);
    assert.equal(invocation.mode, "lift");
    assert.deepEqual(JSON.parse(JSON.stringify(invocation.regions)), [{ start: 1, end: 2 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(invocation.tracks)), [0, 1]);
});

test("leave-gaps removes silent pieces without moving later clips", () => {
    const timeline = createTimeline();
    const host = loadHost(timeline.sequence, timeline.qeSequence);

    const deleted = host.removeTimeRangesCore(
        timeline.sequence,
        [{ start: 1, end: 2 }],
        [0],
        "lift"
    );

    assert.equal(deleted, 2);
    assert.equal(timeline.activity.removed, 2);
    assert.equal(timeline.activity.moved, 0);
    assert.equal(timeline.sequence.videoTracks[0].clips[1].start.seconds, 2);
    assert.equal(timeline.sequence.audioTracks[0].clips[1].start.seconds, 2);
});

test("removal engine safely ignores an empty region list", () => {
    const host = loadHost();
    assert.equal(host.removeTimeRangesCore({}, [], [], "lift"), 0);
});

test("sequence metadata exposes stable identity and converts duration ticks", () => {
    const timeline = createTimeline();
    timeline.sequence.sequenceID = "review-copy";
    timeline.sequence.name = "Review copy";
    timeline.sequence.end = String(10 * 254016000000);
    const host = loadHost(timeline.sequence);
    const response = JSON.parse(host.getSequenceInfo());
    assert.equal(response.success, true);
    assert.equal(response.data.sequenceID, "review-copy");
    assert.equal(response.data.durationSecs, 10);
});

test("region preview seeks with a ticks string only on the analyzed sequence", () => {
    const positions = [];
    const host = loadHost({ sequenceID: "review-copy", setPlayerPosition(ticks) { positions.push(ticks); return true; } });
    assert.equal(JSON.parse(host.previewSilenceRegion("review-copy", 1.5)).success, true);
    assert.deepEqual(positions, [String(1.5 * 254016000000)]);
    for (const seconds of [-1, NaN, Infinity, "1.5"]) {
        assert.equal(JSON.parse(host.previewSilenceRegion("review-copy", seconds)).success, false);
    }
    assert.equal(JSON.parse(host.previewSilenceRegion("another-sequence", 2)).success, false);
    assert.equal(positions.length, 1);
});

test("region preview reports missing sequence and refused playhead movement", () => {
    assert.equal(JSON.parse(loadHost(null).previewSilenceRegion("review-copy", 1)).success, false);
    const host = loadHost({ sequenceID: "review-copy", setPlayerPosition() { return false; } });
    const response = JSON.parse(host.previewSilenceRegion("review-copy", 1));
    assert.equal(response.success, false);
    assert.match(response.error, /could not move the playhead/);
});

test("reviewed actions preserve action routing and reject a different active sequence", () => {
    const host = loadHost({ sequenceID: "review-copy" });
    const calls = [];
    const routes = {
        markers: "addSilenceMarkers", disable: "disableSilentRegions",
        lift: "liftDeleteSilentRegions", ripple: "rippleDeleteSilentRegions"
    };
    for (const [mode, name] of Object.entries(routes)) {
        host[name] = (...args) => { calls.push({ mode, args }); return "routed"; };
        assert.equal(host.applyReviewedSilence("[]", "[0]", mode, "review-copy"), "routed");
    }
    assert.equal(calls.length, 4);
    assert.deepEqual(calls[0].args, ["[]"]);
    assert.deepEqual(calls[2].args, ["[]", "[0]"]);
    const mismatch = JSON.parse(host.applyReviewedSilence("[]", "[0]", "ripple", "another-sequence"));
    assert.equal(mismatch.success, false);
    assert.match(mismatch.error, /active sequence changed/);
    assert.equal(JSON.parse(host.applyReviewedSilence("[]", "[0]", "unknown", "review-copy")).success, false);
    assert.equal(calls.length, 4);
});
