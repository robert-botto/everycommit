// Gathers everything from GitHub. Pure data in, pure data out: no files, no rendering.

import { BRANCH_COMMITS, CALENDAR, MERGED_PRS, MORE_COMMITS, REPOS, VIEWER } from './github.js';
import { createIdentity } from './identity.js';

// accounts: [{ label, login, graphql?, listEmails? }] where graphql and listEmails are built from that
// account's own token. An account with a token is "proven": the token's viewer must be that login,
// which is what stops anyone from adding a stranger's account to their graph. An account without one
// is kept, but only as self-reported.
export async function collect({ accounts, from, to, selfReportedEmails = [], log = () => {} }) {
  const proven = [];
  for (const account of accounts) {
    if (!account.graphql) continue;
    const { viewer } = await account.graphql(VIEWER);
    if (viewer.login.toLowerCase() !== account.login.toLowerCase()) {
      throw new Error(`The token for "${account.label}" belongs to ${viewer.login}, not ${account.login}`);
    }
    if (!account.listEmails) throw new Error(`"${account.label}" needs listEmails to check verified emails`);
    let emails;
    try {
      emails = await account.listEmails();
    } catch (error) {
      throw new Error(`"${account.label}": ${error.message}`);
    }
    const verifiedEmails = emails.filter((e) => e.verified).map((e) => e.email);
    proven.push({ ...account, login: viewer.login, id: viewer.databaseId, verifiedEmails });
  }
  if (!proven.length) throw new Error('At least one account needs a token');

  // GitHub's own calendars: what each profile shows a visitor (or, for its owner, with private counts).
  const calendars = [];
  for (const account of accounts) {
    const client = account.graphql ?? proven[0].graphql;
    const data = await client(CALENDAR, { login: account.login, from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` });
    if (!data.user) throw new Error(`No GitHub user ${account.login}`);
    const days = {};
    for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const day of week.contributionDays) days[day.date] = day.contributionCount;
    }
    calendars.push({ label: account.label, proven: Boolean(account.graphql), days });
  }

  const classify = createIdentity({ accounts: proven, selfReportedEmails });
  const since = `${from}T00:00:00Z`;
  const commits = new Map(); // oid -> { oid, repo, repoCreatedAt, authoredDate, committedDate, ..., kind }
  const seenRepos = new Set();

  for (const account of proven) {
    const repos = [];
    for (let cursor = null, more = true; more; ) {
      const page = (await account.graphql(REPOS, { cursor })).viewer.repositories;
      const recent = page.nodes.filter((repo) => repo.pushedAt && repo.pushedAt >= since);
      repos.push(...recent);
      more = page.pageInfo.hasNextPage && recent.length === page.nodes.length;
      cursor = page.pageInfo.endCursor;
    }
    for (const repo of repos) {
      if (seenRepos.has(repo.nameWithOwner)) continue;
      seenRepos.add(repo.nameWithOwner);
      log(`reading ${seenRepos.size}: ${repo.nameWithOwner}`);
      await readRepo(account.graphql, repo, since, (commit) => {
        const kind = classify(commit.author);
        if (kind === 'other') return;
        const existing = commits.get(commit.oid);
        if (existing) {
          // A commit in a fork and its parent is one commit. Judge it against the oldest repository
          // it appears in, so a fork's later creation date never makes real history look backdated.
          if (Date.parse(repo.createdAt) < Date.parse(existing.repoCreatedAt)) existing.repoCreatedAt = repo.createdAt;
          return;
        }
        commits.set(commit.oid, { ...commit, kind, repo: repo.nameWithOwner, repoCreatedAt: repo.createdAt });
      });
    }
  }

  let mergedPrs = 0;
  for (const account of proven) {
    const data = await account.graphql(MERGED_PRS, { q: `author:${account.login} is:pr is:merged created:${from}..${to}` });
    mergedPrs += data.search.issueCount;
  }

  return { calendars, commits: [...commits.values()], repoCount: seenRepos.size, mergedPrs };
}

// Walks every branch. Branches share most of their history, so once a full page of a branch is
// commits already read from another branch, the rest is shared too and paging stops. Without this,
// a repository with hundreds of branches re-reads the same history once per branch.
//
// Asking for line counts makes GitHub compute diffs, and a big page can time out. Every request
// starts at a comfortable size and halves on failure, down to a floor, before giving up.
async function readRepo(graphql, repo, since, onCommit) {
  const [owner, name] = repo.nameWithOwner.split('/');
  const read = new Set();
  let refsSize = 10;
  let historySize = 50;
  const shrinking = async (request) => {
    for (;;) {
      try {
        return await request();
      } catch (error) {
        if (refsSize === 1 && historySize <= 5) throw error;
        refsSize = Math.max(1, Math.floor(refsSize / 2));
        historySize = Math.max(5, Math.floor(historySize / 2));
      }
    }
  };
  for (let cursor = null, more = true; more; ) {
    const refs = (await shrinking(() => graphql(BRANCH_COMMITS, { owner, name, since, cursor, refs: refsSize, size: historySize }))).repository.refs;
    for (const ref of refs.nodes) {
      let history = ref.target?.history;
      while (history) {
        let unread = 0;
        for (const commit of history.nodes) {
          if (read.has(commit.oid)) continue;
          read.add(commit.oid);
          unread += 1;
          onCommit(commit);
        }
        if (!history.pageInfo.hasNextPage || unread === 0) break;
        const after = history.pageInfo.endCursor;
        const next = await shrinking(() => graphql(MORE_COMMITS, {
          owner, name, ref: `refs/heads/${ref.name}`, since, cursor: after, size: historySize,
        }));
        history = next.repository.ref?.target?.history;
      }
    }
    more = refs.pageInfo.hasNextPage;
    cursor = refs.pageInfo.endCursor;
  }
}
