const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("onboarding uses this repository and puts installation before internals", () => {
    const readme = read("README.md");
    assert.match(readme, /git clone https:\/\/github\.com\/Alx8g\/deadair-premiere\.git\ncd deadair-premiere/);
    assert.match(readme, /Code.*Download ZIP/);
    assert.doesNotMatch(readme, /AutoCut|TimeBolt|A\/V sync stays aligned|Download and extract the release ZIP/);
    assert.ok(readme.indexOf("## Install") < readme.indexOf("## First run"));
    assert.match(readme, /Close gaps also removes existing gaps/);
    assert.match(readme, /not a tested compatibility guarantee/);
});

test("README relative links resolve to tracked documentation or source", () => {
    for (const file of ["README.md", "docs/README.md", "bin/README.md"]) {
        const body = read(file);
        for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
            const target = match[1].split("#")[0];
            if (!target || /^https?:/.test(target)) continue;
            assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file}: ${target}`);
        }
    }
});

test("distribution copy explains video and large-audio FFmpeg requirements consistently", () => {
    for (const file of ["README.md", "bin/README.md", "installer/install-win.bat", "installer/install-mac.sh", ".github/workflows/release.yml", "client/index.html"]) {
        const body = read(file);
        assert.match(body, /150 MB/, file);
        assert.doesNotMatch(body, /Audio-only clips work without it|Place ffmpeg\.exe in the extension|Requires:\*\* FFmpeg installed/, file);
    }
});

test("release packaging uses an allowlist and a named extension root", () => {
    const workflow = read(".github/workflows/release.yml");
    assert.match(workflow, /EXTENSION="\$STAGING\/com\.deadair\.silenceremover"/);
    assert.match(workflow, /cp -R CSXS client host bin installer docs/);
    assert.doesNotMatch(workflow, /zip -r "\$ZIP_NAME" \./);
});
