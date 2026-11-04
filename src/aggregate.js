// Turns collected data into the published activity document. This is the file that gets signed,
// so it carries everything a reader needs to judge it: the policy, what was excluded and why, and
// which numbers are verified versus self-reported. It never carries repository names, logins or
// email addresses.

import { excludeReason, findBursts } from './policy.js';

export const SCHEMA = 'everycommit/activity@1';

export function dateRange(from, to) {
  const dates = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

export function localDay(iso, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso));
}

export function aggregate({ collected, from, to, timeZone, policy, tool, now = new Date(), selfReportedBaseline }) {
  const dates = dateRange(from, to);
  const index = new Map(dates.map((date, i) => [date, i]));
  const zeroes = () => new Array(dates.length).fill(0);

  const excluded = { merge: 0, empty: 0, beforeRepo: 0, future: 0, burst: 0 };
  const candidates = [];
  for (const commit of collected.commits) {
    const reason = excludeReason(commit, { createdAt: commit.repoCreatedAt }, policy, now);
    if (reason) {
      if (commit.kind === 'verified') excluded[reason] += 1;
      continue;
    }
    candidates.push(commit);
  }
  const bursts = findBursts(candidates, policy);

  const verified = zeroes();
  const selfReported = zeroes();
  for (const commit of candidates) {
    if (bursts.has(commit.oid)) {
      if (commit.kind === 'verified') excluded.burst += 1;
      continue;
    }
    const i = index.get(localDay(commit.authoredDate, timeZone));
    if (i === undefined) continue;
    if (commit.kind === 'verified') verified[i] += 1;
    else selfReported[i] += 1;
  }
  // A frozen per-day record you keep yourself (for example one that includes commits never pushed)
  // works as a floor: whatever it holds beyond what was found on GitHub is added, and only ever as
  // self-reported, because nothing outside GitHub can be verified.
  if (selfReportedBaseline) {
    for (const [date, count] of Object.entries(selfReportedBaseline)) {
      const i = index.get(date);
      if (i !== undefined) selfReported[i] += Math.max(0, count - verified[i] - selfReported[i]);
    }
  }

  const calendars = collected.calendars.map(({ label, proven, days }) => ({
    label,
    proven,
    cells: dates.map((date) => days[date] ?? 0),
  }));

  const sum = (cells) => cells.reduce((a, b) => a + b, 0);
  const provenCalendars = calendars.filter((c) => c.proven);
  return {
    schema: SCHEMA,
    tool,
    generatedAt: now.toISOString(),
    timeZone,
    from,
    to,
    policy,
    series: {
      verifiedCommits: verified,
      selfReportedCommits: selfReported,
      githubCalendars: calendars,
    },
    totals: {
      verifiedCommits: sum(verified),
      selfReportedCommits: sum(selfReported),
      githubMainProfile: provenCalendars.length ? sum(provenCalendars[0].cells) : 0,
      githubAllProvenAccounts: sum(provenCalendars.flatMap((c) => c.cells)),
      mergedPullRequests: collected.mergedPrs,
      activeDays: verified.filter((n) => n > 0).length,
      busiestDay: Math.max(0, ...verified),
      repositoriesRead: collected.repoCount,
    },
    excluded,
  };
}

// Recomputes every total from the series. A document whose totals disagree with its own series
// was edited by hand, signed or not.
export function checkConsistency(doc) {
  const problems = [];
  if (doc.schema !== SCHEMA) problems.push(`unknown schema ${doc.schema}`);
  const length = dateRange(doc.from, doc.to).length;
  const sum = (cells) => cells.reduce((a, b) => a + b, 0);
  const { series, totals } = doc;
  for (const [name, cells] of [['verifiedCommits', series.verifiedCommits], ['selfReportedCommits', series.selfReportedCommits]]) {
    if (cells.length !== length) problems.push(`${name} has ${cells.length} days, expected ${length}`);
    if (cells.some((n) => !Number.isInteger(n) || n < 0)) problems.push(`${name} has a non-count value`);
    if (sum(cells) !== totals[name]) problems.push(`${name} total ${totals[name]} does not match its series (${sum(cells)})`);
  }
  const proven = series.githubCalendars.filter((c) => c.proven);
  if (sum(proven.flatMap((c) => c.cells)) !== totals.githubAllProvenAccounts) problems.push('GitHub calendar total does not match its series');
  if (totals.activeDays !== series.verifiedCommits.filter((n) => n > 0).length) problems.push('activeDays does not match');
  return problems;
}
