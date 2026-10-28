// Port of T3 Code's check-nightly-release.cjs for Vekrel. A nightly bundles
// vekrel/desktop plus the engine, web and shared mains (refreshed into the
// subtrees at build time), so "something new" means any of those four heads
// moved since the latest nightly, whose release body records them.
const SUBTREE_REPOS = ["engine", "web", "shared"];
const SOURCE_KEYS = ["desktop", ...SUBTREE_REPOS];
const SOURCES_MARKER = /<!-- nightly-sources (\{.*?\}) -->/;

const isNightlyTag = (tag) => /^v.*-nightly\./.test(tag);

const renderSourcesMarker = (sources) => `<!-- nightly-sources ${JSON.stringify(sources)} -->`;

function parseSourcesMarker(body) {
  const match = SOURCES_MARKER.exec(body ?? "");
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

// Desktop is the commit this run builds; the subtree sources are their mains.
async function resolveSourceHeads({ github, context }) {
  const heads = { desktop: context.sha };
  for (const repo of SUBTREE_REPOS) {
    const { data } = await github.rest.repos.getBranch({
      owner: context.repo.owner,
      repo,
      branch: "main",
    });
    heads[repo] = data.commit.sha;
  }
  return heads;
}

async function findLatestNightly({ github, context }) {
  const releases = await github.paginate(github.rest.repos.listReleases, {
    ...context.repo,
    per_page: 100,
  });
  return releases
    .filter((release) => !release.draft && release.published_at && isNightlyTag(release.tag_name))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
}

async function shouldReleaseNightly({ github, context, core, sources }) {
  const lastNightly = await findLatestNightly({ github, context });
  if (!lastNightly) {
    core.info("No published nightly found. Proceeding with release.");
    return true;
  }

  const previous = parseSourcesMarker(lastNightly.body);
  const changed = SOURCE_KEYS.filter((key) => previous?.[key] !== sources[key]);
  if (changed.length === 0) {
    core.info(`Nothing new since ${lastNightly.tag_name}. Skipping.`);
    return false;
  }

  core.info(`New commits since ${lastNightly.tag_name} in: ${changed.join(", ")}.`);
  return true;
}

module.exports = {
  parseSourcesMarker,
  renderSourcesMarker,
  resolveSourceHeads,
  shouldReleaseNightly,
};
