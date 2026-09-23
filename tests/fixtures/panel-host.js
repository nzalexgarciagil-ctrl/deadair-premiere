/* Test-only Premiere and audio adapters. Never loaded by the installed panel. */
(function (root) {
    "use strict";
    var state = {
        sequence: {
            sequenceID: "test-sequence",
            name: "Interview · review copy",
            fps: 24,
            durationSecs: 10,
            audioTracks: [{ index: 0, name: "Dialogue", clipCount: 1 }, { index: 1, name: "Music", clipCount: 0 }],
            videoTracks: [{ index: 0, name: "Camera", clipCount: 1 }, { index: 1, name: "B-roll", clipCount: 1 }]
        },
        calls: [],
        previewPositions: [],
        actions: [],
        missingMedia: false,
        allQuiet: false,
        noQuiet: false,
        holdAudio: false,
        pendingAudio: null,
        confirmations: [],
        confirmResult: false,
        clips: [{ name: "Interview.wav", mediaPath: "C:/fixtures/interview.wav", startSeconds: 0, endSeconds: 10, inPointSeconds: 0, outPointSeconds: 10 }]
    };
    root.__panelTest = state;
    root.CSInterface = function () {};
    root.CSInterface.prototype.evalScript = function (script, callback) {
        state.calls.push(script);
        var match = script.match(/^(\w+)\((.*)\)$/);
        var args = JSON.parse("[" + match[2] + "]");
        var data;
        var error;
        if (match[1] === "getSequenceInfo") {
            if (state.sequence) data = state.sequence;
            else error = "No active sequence.";
        } else if (match[1] === "getClipMediaPaths") data = state.clips;
        else if (match[1] === "previewSilenceRegion" || match[1] === "applyReviewedSilence") {
            var expected = match[1] === "previewSilenceRegion" ? args[0] : args[3];
            if (!state.sequence || state.sequence.sequenceID !== expected) error = "The active sequence changed. Find quiet sections again before reviewing or applying results.";
            else if (match[1] === "previewSilenceRegion") {
                state.previewPositions.push(args[1]);
                data = { positionSeconds: args[1] };
            } else {
                state.actions.push(args);
                data = args[2] === "markers" ? { markersAdded: JSON.parse(args[0]).length } : { deletedCount: 4 };
            }
        } else if (match[1] === "clearSilenceMarkers") data = { removed: 2 };
        else throw new Error("Unexpected host call: " + script);
        callback(JSON.stringify(error ? { success: false, error: error } : { success: true, data: data }));
    };
    root.cep_node = { require: function (name) {
        if (name !== "fs") throw new Error("Unexpected module: " + name);
        return {
            statSync: function () {
                if (state.missingMedia) throw new Error("Offline fixture");
                return { size: 100 };
            },
            readFileSync: function () { return new Uint8Array(100); }
        };
    } };
    root.AudioContext = function () {};
    root.AudioContext.prototype.close = function () {};
    root.AudioContext.prototype.decodeAudioData = function (bytes, success) {
        function deliver() {
            var samples = new Float32Array(10000);
            for (var i = 0; i < samples.length; i++) {
                var seconds = i / 1000;
                var quiet = state.allQuiet || (!state.noQuiet && ((seconds >= 1 && seconds < 3) || (seconds >= 6 && seconds < 8)));
                samples[i] = quiet ? 0.001 : 0.3;
            }
            success({ sampleRate: 1000, numberOfChannels: 1, duration: 10, length: samples.length, getChannelData: function () { return samples; } });
        }
        if (state.holdAudio) state.pendingAudio = deliver;
        else deliver();
    };
    root.confirm = function (message) { state.confirmations.push(message); return state.confirmResult; };
}(window));
