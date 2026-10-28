const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  parseSourcesMarker,
  renderSourcesMarker,
  shouldReleaseNightly,
} = require("./check-nightly-release.cjs");

const sources = { desktop: "d1", engine: "e1", web: "w1", shared: "s1" };
const core = { info() {} };
const context = { repo: { owner: "vekrel", repo: "desktop" } };
const fakeGithub = (releases) => ({
  rest: { repos: { listReleases: "listReleases" } },
  paginate: async () => releases,
});
const release = (tag, publishedAt, body) => ({
  tag_name: tag,
  published_at: publishedAt,
  draft: false,
  body,
});

test("marker round-trips and tolerates missing or broken markers", () => {
  assert.deepEqual(parseSourcesMarker(`notes\n${renderSourcesMarker(sources)}\nmore`), sources);
  assert.equal(parseSourcesMarker("no marker"), undefined);
  assert.equal(parseSourcesMarker("<!-- nightly-sources {bad} -->"), undefined);
  assert.equal(parseSourcesMarker(null), undefined);
});

test("releases when no nightly exists", async () => {
  const github = fakeGithub([release("v0.1.2", "2026-10-01T00:00:00Z", "")]);
  assert.equal(await shouldReleaseNightly({ github, context, core, sources }), true);
});

test("skips when the latest nightly recorded the same heads", async () => {
  const github = fakeGithub([
    release(
      "v0.1.3-nightly.20261020.1",
      "2026-10-20T00:00:00Z",
      renderSourcesMarker({ ...sources, web: "old" }),
    ),
    release("v0.1.3-nightly.20261027.2", "2026-10-27T00:00:00Z", renderSourcesMarker(sources)),
  ]);
  assert.equal(await shouldReleaseNightly({ github, context, core, sources }), false);
});

test("releases when any one source head moved", async () => {
  const github = fakeGithub([
    release("v0.1.3-nightly.20261027.2", "2026-10-27T00:00:00Z", renderSourcesMarker(sources)),
  ]);
  for (const key of Object.keys(sources)) {
    const moved = { ...sources, [key]: "new" };
    assert.equal(await shouldReleaseNightly({ github, context, core, sources: moved }), true, key);
  }
});

test("releases when the latest nightly has no marker", async () => {
  const github = fakeGithub([release("v0.1.3-nightly.20261027.2", "2026-10-27T00:00:00Z", "")]);
  assert.equal(await shouldReleaseNightly({ github, context, core, sources }), true);
});
