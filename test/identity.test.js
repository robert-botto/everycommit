import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdentity } from '../src/identity.js';

const classify = createIdentity({
  accounts: [
    { login: 'Alice', id: 101, verifiedEmails: ['alice@example.com'] },
    { login: 'alice-work', id: 202, verifiedEmails: ['alice@work.example'] },
  ],
  selfReportedEmails: ['alice@old-laptop.local'],
});

test('linked to a proven account with a verified email: verified', () => {
  assert.equal(classify({ email: 'Alice@Example.com', user: { login: 'alice' } }), 'verified');
  assert.equal(classify({ email: 'alice@work.example', user: { login: 'ALICE-WORK' } }), 'verified');
});

test("the account's own noreply address is verified", () => {
  assert.equal(classify({ email: '101+alice@users.noreply.github.com', user: { login: 'alice' } }), 'verified');
  assert.equal(classify({ email: 'alice@users.noreply.github.com', user: { login: 'alice' } }), 'verified');
});

test('a noreply address with the wrong numeric id is not verified', () => {
  assert.equal(classify({ email: '999+alice@users.noreply.github.com', user: { login: 'alice' } }), 'self-reported');
});

test('linked through an email the account added but never verified: only self-reported', () => {
  // The attack: add a stranger's unclaimed email to your account, fork their repo.
  assert.equal(classify({ email: 'stranger@example.org', user: { login: 'alice' } }), 'self-reported');
});

test('a commit GitHub linked to someone else never counts, even with a listed email', () => {
  assert.equal(classify({ email: 'alice@old-laptop.local', user: { login: 'mallory' } }), 'other');
});

test('an unlinked email you list yourself is only self-reported', () => {
  assert.equal(classify({ email: 'Alice@Old-Laptop.local', user: null }), 'self-reported');
});

test('an unlinked noreply address of a proven account is only self-reported', () => {
  assert.equal(classify({ email: 'alice@users.noreply.github.com', user: null }), 'self-reported');
});

test('a stranger stays out', () => {
  assert.equal(classify({ email: 'bob@example.com', user: null }), 'other');
  assert.equal(classify({ email: 'bob@users.noreply.github.com', user: null }), 'other');
});
