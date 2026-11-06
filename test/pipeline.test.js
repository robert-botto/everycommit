import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate, checkConsistency, localDay } from '../src/aggregate.js';
import { collect } from '../src/collect.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { renderSvg } from '../src/svg.js';

// A fake GitHub: two accounts that can both read one shared repo with two branches.
function fakeGithub(viewerLogin) {
  const c = (oid, date, login, over = {}) => ({
    oid, authoredDate: date, committedDate: date, additions: 1, deletions: 0, changedFilesIfAvailable: 1,
    parents: { totalCount: 1 }, author: { email: `${login ?? 'x'}@example.com`, user: login ? { login } : null }, ...over,
  });
  const main = [c('m1', '2026-02-02T15:00:00Z', 'alice'), c('m2', '2026-02-03T15:00:00Z', 'alice-work')];
  const feature = [c('f1', '2026-02-03T16:00:00Z', 'alice'), ...main];
  const page = (nodes) => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes });
  return async (query, vars) => {
    if (query.includes('viewer { login')) return { viewer: { login: viewerLogin, databaseId: 1 } };
    if (query.includes('contributionCalendar')) {
      return { user: { contributionsCollection: { contributionCalendar: { weeks: [{ contributionDays: [
        { date: '2026-02-02', contributionCount: vars.login === 'alice' ? 1 : 0 },
        { date: '2026-02-03', contributionCount: 1 },
      ] }] } } } };
    }
    if (query.includes('repositories(')) {
      return { viewer: { repositories: page([{ nameWithOwner: 'acme/app', pushedAt: '2026-02-03T16:00:00Z', createdAt: '2026-01-10T00:00:00Z' }]) } };
    }
    if (query.includes('refs(')) {
      return { repository: { refs: page([
        { name: 'main', target: { history: page(main) } },
        { name: 'feature', target: { history: page(feature) } },
      ]) } };
    }
    if (query.includes('search(')) return { search: { issueCount: 2 } };
    throw new Error(`unexpected query ${query.slice(0, 40)}`);
  };
}

const emails = (...list) => async () => list.map((email) => ({ email, verified: true }));

test('collect + aggregate: every branch, deduplicated across accounts, labels only', async () => {
  const collected = await collect({
    accounts: [
      { login: 'alice', label: 'Main profile', graphql: fakeGithub('alice'), listEmails: emails('alice@example.com') },
      { login: 'alice-work', label: 'Work', graphql: fakeGithub('alice-work'), listEmails: emails('alice-work@example.com') },
    ],
    from: '2026-02-01', to: '2026-02-04',
  });
  assert.equal(collected.commits.length, 3, 'the shared repo is read once and shared history counted once');
  const doc = aggregate({ collected, from: '2026-02-01', to: '2026-02-04', timeZone: 'UTC', policy: DEFAULT_POLICY,
    tool: { name: 'everycommit', version: 'test' }, now: new Date('2026-02-05T00:00:00Z') });
  assert.deepEqual(doc.series.verifiedCommits, [0, 1, 2, 0]);
  assert.equal(doc.totals.verifiedCommits, 3);
  assert.equal(doc.totals.githubMainProfile, 2);
  // Calendars: alice [0,1,1,0], alice-work [0,0,1,0] -> GitHub [0,1,2,0]; verified [0,1,2,0].
  assert.deepEqual(doc.series.contributions, [0, 1, 2, 0], 'never below GitHub, verified on top');
  assert.equal(doc.totals.addedBeyondGithub, 0);
  assert.equal(doc.totals.githubAllProvenAccounts, 3);
  assert.equal(doc.totals.mergedPullRequests, 4);
  assert.deepEqual(checkConsistency(doc), []);
  const text = JSON.stringify(doc);
  assert.ok(!text.includes('acme') && !text.includes('alice'), 'no repository names or logins are published');
  assert.match(renderSvg(doc), /3 contributions/);
});

test('a token that belongs to someone else is refused', async () => {
  await assert.rejects(
    collect({ accounts: [{ login: 'torvalds', label: 'Borrowed', graphql: fakeGithub('alice'), listEmails: emails() }], from: '2026-02-01', to: '2026-02-04' }),
    /belongs to alice, not torvalds/,
  );
});

test('an account whose token cannot read its emails fails loudly instead of counting less', async () => {
  const listEmails = async () => { throw new Error('this token cannot read its account email addresses'); };
  await assert.rejects(
    collect({ accounts: [{ login: 'alice', label: 'Main', graphql: fakeGithub('alice'), listEmails }], from: '2026-02-01', to: '2026-02-04' }),
    /"Main": this token cannot read/,
  );
});

test('consistency check catches a hand-edited total', async () => {
  const collected = { calendars: [], commits: [], repoCount: 0, mergedPrs: 0 };
  const doc = aggregate({ collected, from: '2026-02-01', to: '2026-02-02', timeZone: 'UTC', policy: DEFAULT_POLICY, tool: {} });
  doc.totals.verifiedCommits = 9000;
  assert.match(checkConsistency(doc).join(), /does not match/);
});

test('the headline never goes below GitHub, and only verified commits add to it', () => {
  const verifiedCommit = (oid, day) => ({ oid, kind: 'verified', authoredDate: `${day}T12:00:00Z`, committedDate: `${day}T12:00:00Z`,
    additions: 1, deletions: 0, changedFilesIfAvailable: 1, parents: { totalCount: 1 }, repo: 'r', repoCreatedAt: '2026-01-01T00:00:00Z' });
  const collected = { repoCount: 1, mergedPrs: 0,
    calendars: [{ label: 'Main', proven: true, days: { '2026-02-01': 5 } }, { label: 'Stranger', proven: false, days: { '2026-02-02': 9 } }],
    commits: [verifiedCommit('a', '2026-02-02'), verifiedCommit('b', '2026-02-02')] };
  const doc = aggregate({ collected, from: '2026-02-01', to: '2026-02-02', timeZone: 'UTC', policy: DEFAULT_POLICY, tool: {},
    now: new Date('2026-02-03T00:00:00Z') });
  assert.deepEqual(doc.series.contributions, [5, 2], 'an unproven calendar adds nothing');
  assert.equal(doc.totals.addedBeyondGithub, 2);
  assert.deepEqual(checkConsistency(doc), []);
});

test('commits are dated in the configured time zone', () => {
  assert.equal(localDay('2026-02-03T02:00:00Z', 'America/New_York'), '2026-02-02');
  assert.equal(localDay('2026-02-03T02:00:00Z', 'UTC'), '2026-02-03');
});

test('a self-reported baseline only fills what GitHub did not show', () => {
  const collected = { calendars: [], repoCount: 0, mergedPrs: 0, commits: [{
    oid: 'a', kind: 'verified', authoredDate: '2026-02-01T12:00:00Z', committedDate: '2026-02-01T12:00:00Z',
    additions: 1, deletions: 0, changedFilesIfAvailable: 1, parents: { totalCount: 1 }, repo: 'r', repoCreatedAt: '2026-01-01T00:00:00Z',
  }] };
  const doc = aggregate({ collected, from: '2026-02-01', to: '2026-02-02', timeZone: 'UTC', policy: DEFAULT_POLICY, tool: {},
    now: new Date('2026-02-03T00:00:00Z'), selfReportedBaseline: { '2026-02-01': 5, '2026-02-02': 0 } });
  assert.deepEqual(doc.series.verifiedCommits, [1, 0]);
  assert.deepEqual(doc.series.selfReportedCommits, [4, 0]);
});
