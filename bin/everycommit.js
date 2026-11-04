#!/usr/bin/env node
// everycommit: a true, verified contribution graph across every GitHub account you own.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { aggregate, checkConsistency } from '../src/aggregate.js';
import { collect } from '../src/collect.js';
import { loadConfig } from '../src/config.js';
import { createClient, fetchEmails } from '../src/github.js';
import { renderSvg } from '../src/svg.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const SIGNER_WORKFLOW = 'robert-botto/everycommit/.github/workflows/generate.yml';

const HELP = `everycommit ${pkg.version}

Usage:
  everycommit init                     write everycommit.config.json from your gh CLI logins
  everycommit collect [options]        read GitHub and write activity.json (and an SVG)
      --config <path>                  default everycommit.config.json
      --out <path>                     default activity.json
      --svg <path>                     also write a static SVG
      --use-gh-cli                     take missing tokens from \`gh auth token --user <login>\`
  everycommit svg <activity.json> [--out <path>] [--theme light|dark]
  everycommit verify <activity.json> --repo <owner/repo>
                                       check the file is internally consistent and was signed by
                                       the official everycommit workflow
`;

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'collect') await runCollect(rest);
  else if (command === 'svg') runSvg(rest);
  else if (command === 'verify') runVerify(rest);
  else if (command === 'init') runInit();
  else process.stdout.write(HELP);
} catch (error) {
  console.error(`everycommit: ${error.message}`);
  process.exit(1);
}

async function runCollect(args) {
  const { values } = parseArgs({ args, options: {
    config: { type: 'string', default: 'everycommit.config.json' },
    out: { type: 'string', default: 'activity.json' },
    svg: { type: 'string' },
    'use-gh-cli': { type: 'boolean', default: false },
  } });
  const env = { ...process.env };
  if (values['use-gh-cli']) {
    const raw = JSON.parse(readFileSync(values.config, 'utf8'));
    for (const account of raw.accounts) {
      if (account.tokenEnv && !env[account.tokenEnv]) {
        env[account.tokenEnv] = execFileSync('gh', ['auth', 'token', '--user', account.login], { encoding: 'utf8' }).trim();
      }
    }
  }
  const config = loadConfig(values.config, env);
  const accounts = config.accounts.map((a) => ({
    ...a,
    graphql: a.token ? createClient(a.token) : undefined,
    listEmails: a.token ? () => fetchEmails(a.token) : undefined,
  }));
  const started = Date.now();
  const collected = await collect({
    accounts, from: config.from, to: config.to, selfReportedEmails: config.selfReportedEmails,
    log: (line) => process.stderr.write(`\r\x1b[K${line}`),
  });
  process.stderr.write('\r\x1b[K');
  const doc = aggregate({
    collected, from: config.from, to: config.to, timeZone: config.timeZone, policy: config.policy,
    tool: { name: pkg.name, version: pkg.version }, selfReportedBaseline: readBaseline(config.selfReportedBaseline),
  });
  writeFileSync(values.out, JSON.stringify(doc) + '\n');
  if (values.svg) writeFileSync(values.svg, renderSvg(doc));
  const t = doc.totals;
  console.log(`${t.verifiedCommits} verified commits across ${t.activeDays} days from ${t.repositoriesRead} repositories ` +
    `(${Math.round((Date.now() - started) / 1000)}s)`);
  console.log(`GitHub credits ${t.githubCommitsMainProfile} commits to the main profile, ${t.githubCommitsAllProvenAccounts} across proven accounts`);
  console.log(`self-reported ${t.selfReportedCommits}; excluded ${JSON.stringify(doc.excluded)}`);
  console.log(`wrote ${values.out}${values.svg ? ` and ${values.svg}` : ''}`);
}

// Accepts { "YYYY-MM-DD": n } or { "start": "YYYY-MM-DD", "cells": [n, ...] }.
function readBaseline(path) {
  if (!path) return undefined;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw.cells)) return raw;
  const start = Date.parse(`${raw.start}T00:00:00Z`);
  return Object.fromEntries(raw.cells.map((n, i) => [new Date(start + i * 86_400_000).toISOString().slice(0, 10), n]));
}

function runSvg(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    out: { type: 'string', default: 'activity.svg' }, theme: { type: 'string', default: 'light' },
  } });
  const doc = JSON.parse(readFileSync(positionals[0] ?? 'activity.json', 'utf8'));
  writeFileSync(values.out, renderSvg(doc, { theme: values.theme }));
  console.log(`wrote ${values.out}`);
}

function runVerify(args) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { repo: { type: 'string' } } });
  const file = positionals[0] ?? 'activity.json';
  const problems = checkConsistency(JSON.parse(readFileSync(file, 'utf8')));
  if (problems.length) throw new Error(`${file} is not consistent:\n  ${problems.join('\n  ')}`);
  console.log(`consistent: every total matches its series`);
  if (!values.repo) throw new Error('pass --repo <owner/repo> (the public repository that published the file) to check its signature');
  const ghArgs = ['attestation', 'verify', file, '--repo', values.repo, '--signer-workflow', SIGNER_WORKFLOW];
  try {
    execFileSync('gh', ghArgs, { stdio: 'inherit' });
  } catch {
    throw new Error(`signature check failed. Run it yourself to see why:\n  gh ${ghArgs.join(' ')}`);
  }
  console.log('signed by the official everycommit workflow');
}

function runInit() {
  const path = 'everycommit.config.json';
  if (existsSync(path)) throw new Error(`${path} already exists`);
  let logins = [];
  try {
    const status = JSON.parse(execFileSync('gh', ['auth', 'status', '--json', 'hosts'], { encoding: 'utf8' }));
    logins = (status.hosts['github.com'] ?? []).map((entry) => entry.login);
  } catch {
    // Older gh versions have no --json; fall back to an empty template.
  }
  if (!logins.length) logins = ['your-login'];
  const config = {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    accounts: logins.map((login, i) => ({ login, label: i === 0 ? 'Main profile' : `Account ${i + 1}`, tokenEnv: `EVERYCOMMIT_TOKEN_${i + 1}` })),
  };
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
  console.log(`wrote ${path} with ${logins.length} account(s). Try it locally with:\n  npx everycommit collect --use-gh-cli --svg activity.svg`);
}
