import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_POLICY, excludeReason, findBursts, resolvePolicy } from '../src/policy.js';

const repo = { createdAt: '2026-03-01T00:00:00Z' };
const now = new Date('2026-06-01T00:00:00Z');
const commit = (over = {}) => ({
  oid: 'a', authoredDate: '2026-04-01T10:00:00Z', committedDate: '2026-04-01T10:00:00Z',
  additions: 3, deletions: 1, changedFilesIfAvailable: 1, parents: { totalCount: 1 }, ...over,
});

test('an ordinary commit passes', () => {
  assert.equal(excludeReason(commit(), repo, DEFAULT_POLICY, now), null);
});

test('merge commits are excluded', () => {
  assert.equal(excludeReason(commit({ parents: { totalCount: 2 } }), repo, DEFAULT_POLICY, now), 'merge');
});

test('empty commits are excluded, but a pure rename is not', () => {
  assert.equal(excludeReason(commit({ additions: 0, deletions: 0, changedFilesIfAvailable: 0 }), repo, DEFAULT_POLICY, now), 'empty');
  assert.equal(excludeReason(commit({ additions: 0, deletions: 0, changedFilesIfAvailable: 2 }), repo, DEFAULT_POLICY, now), null);
  assert.equal(excludeReason(commit({ additions: 0, deletions: 0, changedFilesIfAvailable: null }), repo, DEFAULT_POLICY, now), null);
});

test('commits made before the repository existed are excluded', () => {
  const backdated = commit({ authoredDate: '2026-01-05T00:00:00Z', committedDate: '2026-01-05T00:00:00Z' });
  assert.equal(excludeReason(backdated, repo, DEFAULT_POLICY, now), 'beforeRepo');
  const loose = resolvePolicy({ excludeBeforeRepo: false });
  assert.equal(excludeReason(backdated, repo, loose, now), null);
});

test('future-dated commits are excluded', () => {
  assert.equal(excludeReason(commit({ authoredDate: '2026-06-03T00:00:00Z' }), repo, DEFAULT_POLICY, now), 'future');
});

test('unknown policy keys are rejected so a typo cannot silently loosen a rule', () => {
  assert.throws(() => resolvePolicy({ excludeMerge: false }), /Unknown policy setting/);
});

test('bursts: more than the limit within the window in one repo are flagged', () => {
  const policy = resolvePolicy({ burstLimit: 3, burstWindowSeconds: 60 });
  const at = (s) => new Date(Date.parse('2026-04-01T00:00:00Z') + s * 1000).toISOString();
  const commits = [0, 5, 10, 15].map((s, i) => ({ oid: `b${i}`, repo: 'r', authoredDate: at(s) }));
  commits.push({ oid: 'calm', repo: 'r', authoredDate: at(3600) });
  commits.push(...[0, 5, 10].map((s, i) => ({ oid: `o${i}`, repo: 'other', authoredDate: at(s) })));
  assert.deepEqual([...findBursts(commits, policy)].sort(), ['b0', 'b1', 'b2', 'b3']);
});
