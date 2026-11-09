# Contributing

Thanks for helping. A few ground rules keep everycommit small and trustworthy.

- **Zero runtime dependencies.** The collector and widget use only Node 22+ and the browser. Proposals that add a dependency need a strong reason.
- **Never weaken a check silently.** Anything that changes what counts as verified, or what a policy filter excludes, needs a test showing the attack it closes or the case it now allows.
- **No personal data in output.** `activity.json` holds per-day counts only: no logins, emails or repository names.
- **No em dashes** in code, comments or docs. `npm run check` enforces it.

## Development

```sh
npm test        # unit and pipeline tests, no network
npm run check   # widget syntax, no em dashes anywhere
```

Open a pull request against `main`. CI runs both commands. For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
