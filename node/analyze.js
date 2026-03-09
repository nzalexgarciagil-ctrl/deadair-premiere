#!/usr/bin/env node
/**
 * DeadAir Audio Analyzer
 *
 * Uses FFmpeg silencedetect filter to find silent regions in audio files.
 * Called by the CEP extension frontend via Node.js child_process.
 *
 * Usage:
 *   node analyze.js --file <path> [--threshold -35] [--duration 0.8] [--padding 0.1]
 *                   [--clip-start 0] [--clip-end 0] [--ffmpeg <path>]
 *
 * Output: JSON object with silence regions to stdout
 */

var childProcess = require("child_process");
var path = require("path");

// Parse CLI arguments
function parseArgs(argv) {
    var args = {
        file: "",
        threshold: -35,
        duration: 0.8,
        padding: 0.1,
        clipStart: 0,     // timeline start of this clip (seconds)
        clipEnd: 0,       // timeline end of this clip (seconds)
        clipInPoint: 0,   // source in-point (seconds)
        ffmpeg: "ffmpeg"
    };

    for (var i = 2; i < argv.length; i++) {
        switch (argv[i]) {
            case "--file":
                args.file = argv[++i];
                break;
            case "--threshold":
                args.threshold = parseFloat(argv[++i]);
                break;
            case "--duration":
                args.duration = parseFloat(argv[++i]);
                break;
            case "--padding":
                args.padding = parseFloat(argv[++i]);
                break;
            case "--clip-start":
                args.clipStart = parseFloat(argv[++i]);
                break;
            case "--clip-end":
                args.clipEnd = parseFloat(argv[++i]);
                break;
            case "--clip-in-point":
                args.clipInPoint = parseFloat(argv[++i]);
                break;
            case "--ffmpeg":
                args.ffmpeg = argv[++i];
                break;
        }
    }
    return args;
}

function analyzeFile(args) {
    return new Promise(function (resolve, reject) {
        var clipDuration = args.clipEnd - args.clipStart;
        if (clipDuration <= 0) {
            resolve({ regions: [], totalSilence: 0 });
            return;
        }

        // Build FFmpeg command for silence detection
        // -ss and -t to only analyze the portion of the file used in the timeline
        var ffmpegArgs = [
            "-ss", String(args.clipInPoint),
            "-t", String(clipDuration),
            "-i", args.file,
            "-af", "silencedetect=noise=" + args.threshold + "dB:d=" + args.duration,
            "-f", "null",
            "-"
        ];

        var stderr = "";
        var proc = childProcess.spawn(args.ffmpeg, ffmpegArgs, {
            stdio: ["ignore", "ignore", "pipe"]
        });

        proc.stderr.on("data", function (chunk) {
            stderr += chunk.toString();
        });

        proc.on("close", function (code) {
            if (code !== 0 && stderr.indexOf("silence_start") === -1) {
                reject(new Error("FFmpeg exited with code " + code + ": " + stderr.substring(0, 500)));
                return;
            }

            var regions = parseSilenceDetect(stderr, args);
            var totalSilence = 0;
            for (var i = 0; i < regions.length; i++) {
                totalSilence += regions[i].end - regions[i].start;
            }

            resolve({
                regions: regions,
                totalSilence: Math.round(totalSilence * 100) / 100
            });
        });

        proc.on("error", function (err) {
            reject(new Error("Failed to run FFmpeg: " + err.message +
                "\n\nMake sure FFmpeg is installed and accessible. " +
                "Download from https://ffmpeg.org/download.html"));
        });
    });
}

function parseSilenceDetect(output, args) {
    var regions = [];
    var lines = output.split("\n");
    var currentStart = null;

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        // Parse silence_start
        var startMatch = line.match(/silence_start:\s*([\d.]+)/);
        if (startMatch) {
            currentStart = parseFloat(startMatch[1]);
        }

        // Parse silence_end
        var endMatch = line.match(/silence_end:\s*([\d.]+)/);
        if (endMatch && currentStart !== null) {
            var silenceEnd = parseFloat(endMatch[1]);

            // Convert source-file timestamps to timeline timestamps
            // source time = clipInPoint + offset -> timeline time = clipStart + offset
            var timelineStart = args.clipStart + (currentStart - 0);
            var timelineEnd = args.clipStart + (silenceEnd - 0);

            // Apply padding (shrink the silence region)
            timelineStart += args.padding;
            timelineEnd -= args.padding;

            // Clamp to clip boundaries
            timelineStart = Math.max(timelineStart, args.clipStart);
            timelineEnd = Math.min(timelineEnd, args.clipEnd);

            // Only add if region is still valid after padding
            if (timelineEnd - timelineStart > 0.05) {
                regions.push({
                    start: Math.round(timelineStart * 1000) / 1000,
                    end: Math.round(timelineEnd * 1000) / 1000
                });
            }

            currentStart = null;
        }
    }

    // Handle case where silence extends to end of clip
    if (currentStart !== null) {
        var timelineStart = args.clipStart + (currentStart - 0);
        timelineStart += args.padding;
        var timelineEnd = args.clipEnd - args.padding;

        if (timelineEnd - timelineStart > 0.05) {
            regions.push({
                start: Math.round(timelineStart * 1000) / 1000,
                end: Math.round(timelineEnd * 1000) / 1000
            });
        }
    }

    return regions;
}

// Merge overlapping regions (from multiple clips/tracks)
function mergeRegions(allRegions) {
    if (allRegions.length === 0) return [];

    // Sort by start time
    allRegions.sort(function (a, b) { return a.start - b.start; });

    var merged = [allRegions[0]];
    for (var i = 1; i < allRegions.length; i++) {
        var last = merged[merged.length - 1];
        if (allRegions[i].start <= last.end) {
            // For intersection-based merging: only keep overlapping part
            // This means silence must exist on ALL analyzed tracks
            last.start = Math.max(last.start, allRegions[i].start);
            last.end = Math.min(last.end, allRegions[i].end);
            if (last.end <= last.start) {
                merged.pop();
            }
        } else {
            merged.push(allRegions[i]);
        }
    }
    return merged;
}

// Main
var args = parseArgs(process.argv);

if (!args.file) {
    // If no file specified, read batch job from stdin
    var input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", function (chunk) { input += chunk; });
    process.stdin.on("end", function () {
        try {
            var job = JSON.parse(input);
            processBatch(job);
        } catch (e) {
            console.error(JSON.stringify({ success: false, error: e.message }));
            process.exit(1);
        }
    });
} else {
    // Single file mode
    analyzeFile(args)
        .then(function (result) {
            console.log(JSON.stringify({ success: true, data: result }));
        })
        .catch(function (err) {
            console.error(JSON.stringify({ success: false, error: err.message }));
            process.exit(1);
        });
}

function processBatch(job) {
    var clips = job.clips || [];
    var threshold = job.threshold || -35;
    var duration = job.duration || 0.8;
    var padding = job.padding || 0.1;
    var ffmpegPath = job.ffmpeg || "ffmpeg";
    var mode = job.mode || "intersection"; // "intersection" or "union"

    var promises = [];
    for (var i = 0; i < clips.length; i++) {
        var clip = clips[i];
        promises.push(analyzeFile({
            file: clip.mediaPath,
            threshold: threshold,
            duration: duration,
            padding: padding,
            clipStart: clip.startSeconds,
            clipEnd: clip.endSeconds,
            clipInPoint: clip.inPointSeconds,
            ffmpeg: ffmpegPath
        }));
    }

    Promise.all(promises)
        .then(function (results) {
            // Collect all regions
            var allRegions = [];
            for (var i = 0; i < results.length; i++) {
                allRegions = allRegions.concat(results[i].regions);
            }

            var finalRegions;
            if (mode === "intersection" && clips.length > 1) {
                finalRegions = intersectRegions(results);
            } else {
                finalRegions = mergeRegions(allRegions);
            }

            var totalSilence = 0;
            for (var i = 0; i < finalRegions.length; i++) {
                totalSilence += finalRegions[i].end - finalRegions[i].start;
            }

            console.log(JSON.stringify({
                success: true,
                data: {
                    regions: finalRegions,
                    totalSilence: Math.round(totalSilence * 100) / 100,
                    clipCount: clips.length
                }
            }));
        })
        .catch(function (err) {
            console.error(JSON.stringify({ success: false, error: err.message }));
            process.exit(1);
        });
}

// Find silence regions that exist across ALL tracks (intersection)
function intersectRegions(results) {
    if (results.length === 0) return [];
    if (results.length === 1) return results[0].regions;

    // Start with first track's regions
    var intersection = results[0].regions.slice();

    for (var r = 1; r < results.length; r++) {
        var other = results[r].regions;
        var newIntersection = [];

        for (var i = 0; i < intersection.length; i++) {
            for (var j = 0; j < other.length; j++) {
                var overlapStart = Math.max(intersection[i].start, other[j].start);
                var overlapEnd = Math.min(intersection[i].end, other[j].end);
                if (overlapEnd > overlapStart + 0.05) {
                    newIntersection.push({
                        start: Math.round(overlapStart * 1000) / 1000,
                        end: Math.round(overlapEnd * 1000) / 1000
                    });
                }
            }
        }

        intersection = newIntersection;
    }

    return intersection;
}
