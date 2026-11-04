# everycommit

**Every commit. Every account. Verified.**

GitHub's contribution graph shows one account, counts only commits that land on the default branch, and collapses a squash-merged pull request into a single commit. If you work across a personal account, a work account and a side-project account, most of what you ship is invisible.

everycommit reads every branch of every repository your accounts can see, deduplicates commits by SHA across accounts, filters out faked commits, and publishes one signed graph you can embed anywhere.

> Status: private, pre-release. Signing needs this repository to be public (see [Signing](#signing)).

## What makes it different

| | GitHub's graph | Graph mergers (sum calendars) | Commit importers (fake commits) | everycommit |
|---|---|---|---|---|
| Several accounts | No | Yes | Yes | Yes |
| Commits on every branch | No | No | No | Yes |
| Deduplicated by SHA | n/a | No | No | Yes |
| Private repositories | Own profile only | Usually not | Yes | Yes, read-only |
| Filters faked commits | No | No | They are the fake commits | Yes |
| Signed, verifiable output | n/a | No | No | Yes |

## How it stays honest

A graph is only worth showing if nobody can fake it. These rules are built in, and every setting is copied into the signed output so readers can see exactly what produced a number.

| Way to fake it | What stops it |
|---|---|
| Edit `activity.json` by hand | The file is signed by the official workflow. `everycommit verify` checks the signature and that the signer was this workflow at a pinned version, and recomputes every total from the daily series. |
| Run a modified copy of the tool | The official workflow runs its own code at its own commit, taken from the job's OIDC claims, never code from your repository. A modified fork signs as a different workflow and fails verification. |
| Claim someone else's commits | A commit counts only when GitHub linked its author to an account you proved with that account's own token **and** its email is verified on that account (or is the account's own noreply address). GitHub links commits to an email that was merely added, without proof of the mailbox, so the verified check is what stops someone adding a stranger's email and forking their repository. |
| Add a stranger's account | Each account's token must belong to that account. A login without a token is only ever self-reported. |
| Graph-painting scripts and backdated commits | Excluded and counted: empty commits, commits made before their repository existed, bursts of more than 20 commits a minute in one repository, future-dated commits. Merge commits are excluded because they repeat work already counted. |
| Use everycommit to generate commits | It never writes to any repository. It needs read-only tokens only. |

What signing cannot prove: that the work was good. A determined person can still write real but meaningless commits. everycommit shows *verified, not faked*, never *productivity*.

### Verified versus self-reported

- **Verified commits**: linked by GitHub to an account you proved, under an email verified on that account, and passed every filter. This is the headline number.
- **GitHub calendars**: GitHub's own per-account numbers, shown in the reveal so viewers can compare. They include issues, reviews and pull requests, and they are not filtered.
- **Self-reported**: commits under an email GitHub does not link to your account or that the account has not verified, and any frozen record you supply (for example commits that were never pushed). Shown separately, never added to the verified total. To move commits into verified, add their email to the right GitHub account and verify it.

## Quick start (local)

Requires Node 22+ and, for the easiest setup, the [GitHub CLI](https://cli.github.com) logged in to each account (`gh auth login`), with the `user:email` scope so everycommit can see which emails each account has verified (`gh auth refresh -s user:email`).

```sh
npx everycommit init                                  # writes everycommit.config.json from your gh logins
npx everycommit collect --use-gh-cli --svg activity.svg
```

## Publish a signed graph

1. Create a **public** repository, for example `<you>/activity`. It only ever holds per-day counts.
2. Add `everycommit.config.json` (below) and copy [`examples/caller.yml`](examples/caller.yml) to `.github/workflows/everycommit.yml`.
3. For each account, create a fine-grained token **while logged in as that account**: all repositories, read-only Contents, Metadata and Pull requests, plus the account permission Email addresses (read). Save them as repository secrets `EVERYCOMMIT_TOKEN_1`, `EVERYCOMMIT_TOKEN_2`, ...
4. Enable Pages (Settings, Pages, Source: GitHub Actions) and run the workflow.

Embed it:

```html
<script type="module" src="https://<you>.github.io/activity/every-commit.js"></script>
<every-commit src="https://<you>.github.io/activity/activity.json" attestation-repo="<you>/activity"></every-commit>
```

Or use the static `activity.svg` in a README.

Anyone can check it:

```sh
npx everycommit verify activity.json --repo <you>/activity
```

## Config

```json
{
  "timeZone": "America/New_York",
  "from": "2026-01-01",
  "accounts": [
    { "login": "you", "label": "Main profile", "tokenEnv": "EVERYCOMMIT_TOKEN_1" },
    { "login": "you-at-work", "label": "Work", "tokenEnv": "EVERYCOMMIT_TOKEN_2" }
  ],
  "selfReportedEmails": ["you@old-laptop.local"],
  "selfReportedBaseline": "baseline.json",
  "policy": { "burstLimit": 20 }
}
```

- `label` is what viewers see. Logins, repository names and emails are never published.
- The first account with a token is the "main profile" the reveal starts from.
- `from` defaults to January 1 of the current year, `to` to today, both in `timeZone`.
- `policy` keys: `excludeMerges`, `excludeEmpty`, `excludeBeforeRepo`, `burstLimit`, `burstWindowSeconds`, `futureToleranceHours`. Unknown keys are an error, so a typo can never silently loosen a rule.

## Output

`activity.json` (schema `everycommit/activity@1`): the date range, time zone and policy; daily series for verified commits, self-reported commits and each account's GitHub calendar; totals; and how many commits each filter excluded.

## Signing

Signing uses [GitHub artifact attestations](https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds). GitHub stores attestations for private repositories only on Enterprise Cloud, so the publishing repository must be public. For the same reason, other people can only call the official workflow once this repository is public, and the signing path has not been run end to end yet.

## Development

```sh
npm test        # unit and pipeline tests, no network
npm run check   # no em dashes anywhere
```

`docs/the-reveal.html` is the original design prototype.

## License

MIT
