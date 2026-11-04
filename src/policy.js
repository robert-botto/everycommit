// Anti-faking filters. Every setting here is copied into the signed output, so anyone reading a
// graph can see exactly which rules produced it. Loosening a rule is allowed; hiding that you did
// is not.

export const DEFAULT_POLICY = Object.freeze({
  excludeMerges: true, // merge commits repeat work already counted on the branch
  excludeEmpty: true, // no lines and no files changed: the signature of graph-painting scripts
  excludeBeforeRepo: true, // committed before the repository existed: backdated history
  burstLimit: 20, // more than this many commits authored within burstWindowSeconds in one repo
  burstWindowSeconds: 60,
  futureToleranceHours: 24, // dated in the future beyond clock skew
});

export function resolvePolicy(overrides = {}) {
  const policy = { ...DEFAULT_POLICY, ...overrides };
  for (const key of Object.keys(overrides)) {
    if (!(key in DEFAULT_POLICY)) throw new Error(`Unknown policy setting: ${key}`);
  }
  return Object.freeze(policy);
}

// Returns the reason a single commit is excluded, or null. Burst detection needs the whole set,
// so it lives in findBursts below.
export function excludeReason(commit, repo, policy, now = new Date()) {
  if (policy.excludeMerges && commit.parents?.totalCount > 1) return 'merge';
  if (policy.excludeEmpty && commit.additions === 0 && commit.deletions === 0 && commit.changedFilesIfAvailable === 0) {
    return 'empty';
  }
  const committed = Date.parse(commit.committedDate);
  if (policy.excludeBeforeRepo && repo?.createdAt && committed < Date.parse(repo.createdAt) - 3_600_000) {
    return 'beforeRepo';
  }
  if (Date.parse(commit.authoredDate) > now.getTime() + policy.futureToleranceHours * 3_600_000) return 'future';
  return null;
}

// commits: [{ oid, repo, authoredDate }]. Returns the set of oids inside any window where one repo
// received more than burstLimit commits. Uses authored time, which a rebase preserves, so an
// honest rebase (which rewrites committer time) is not mistaken for a burst.
export function findBursts(commits, policy) {
  const flagged = new Set();
  if (!policy.burstLimit) return flagged;
  const byRepo = new Map();
  for (const commit of commits) {
    if (!byRepo.has(commit.repo)) byRepo.set(commit.repo, []);
    byRepo.get(commit.repo).push({ oid: commit.oid, t: Date.parse(commit.authoredDate) });
  }
  const windowMs = policy.burstWindowSeconds * 1000;
  for (const list of byRepo.values()) {
    list.sort((a, b) => a.t - b.t);
    let start = 0;
    for (let end = 0; end < list.length; end += 1) {
      while (list[end].t - list[start].t > windowMs) start += 1;
      if (end - start + 1 > policy.burstLimit) {
        for (let i = start; i <= end; i += 1) flagged.add(list[i].oid);
      }
    }
  }
  return flagged;
}
