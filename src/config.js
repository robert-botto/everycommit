// Reads everycommit.config.json. Tokens are never in the config: each account names the
// environment variable that holds its token.

import { readFileSync } from 'node:fs';
import { resolvePolicy } from './policy.js';

export function loadConfig(path, env = process.env, today = new Date()) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw.accounts) || !raw.accounts.length) throw new Error('config.accounts must list at least one account');
  const timeZone = raw.timeZone ?? 'UTC';
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone }).format(today);
  const accounts = raw.accounts.map((account, i) => {
    if (!account.login) throw new Error(`accounts[${i}] needs a login`);
    const token = account.tokenEnv ? env[account.tokenEnv] : undefined;
    if (account.tokenEnv && !token) throw new Error(`accounts[${i}]: environment variable ${account.tokenEnv} is not set`);
    return { login: account.login, label: account.label ?? `Account ${i + 1}`, token };
  });
  return {
    accounts,
    timeZone,
    from: raw.from ?? `${todayLocal.slice(0, 4)}-01-01`,
    to: raw.to ?? todayLocal,
    policy: resolvePolicy(raw.policy),
    selfReportedEmails: raw.selfReportedEmails ?? [],
    selfReportedBaseline: raw.selfReportedBaseline,
  };
}
