# Security

everycommit's whole job is a graph nobody can inflate. A way to fake one is a security bug, and so is anything that leaks a token or a private repository name.

## Reporting

Please report privately through [GitHub's private vulnerability reporting](https://github.com/robert-botto/everycommit/security/advisories/new), not in a public issue. Include the steps to reproduce and, if you can, a sample `activity.json`.

You can expect a reply within 7 days. Fixes ship as a new release, and the advisory credits you unless you would rather stay anonymous.

## In scope

- Getting commits counted as verified that the account owner did not author (for example through an unverified email, a borrowed token, or a forked repository).
- Producing an `activity.json` that passes `everycommit verify` but was not made by the official workflow, or whose totals do not match its series.
- Inflating counts past the policy filters (merges, empty commits, backdating, future dates, bursts).
- The reusable workflow or the widget leaking tokens, logins, emails or repository names.

## Out of scope

- Commits that are genuine but trivial. everycommit proves who wrote a commit and when, not that it was worth writing.
- Self-reported counts. They are labeled as unverified by design.
