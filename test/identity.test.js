import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdentity } from '../src/identity.js';

const classify = createIdentity({ provenLogins: ['Alice', 'alice-work'], selfReportedEmails: ['alice@old-laptop.local'] });

test('a commit GitHub linked to a proven account is verified', () => {
  assert.equal(classify({ email: 'anything@example.com', user: { login: 'alice' } }), 'verified');
  assert.equal(classify({ email: 'x@y.z', user: { login: 'ALICE-WORK' } }), 'verified');
});

test('a commit GitHub linked to someone else never counts, even with a listed email', () => {
  assert.equal(classify({ email: 'alice@old-laptop.local', user: { login: 'mallory' } }), 'other');
});

test('an unlinked email you list yourself is only self-reported', () => {
  assert.equal(classify({ email: 'Alice@Old-Laptop.local', user: null }), 'self-reported');
});

test('an unlinked noreply address of a proven account is only self-reported', () => {
  assert.equal(classify({ email: 'alice@users.noreply.github.com', user: null }), 'self-reported');
  assert.equal(classify({ email: '123+alice-work@users.noreply.github.com', user: null }), 'self-reported');
});

test('a stranger stays out', () => {
  assert.equal(classify({ email: 'bob@example.com', user: null }), 'other');
  assert.equal(classify({ email: 'bob@users.noreply.github.com', user: null }), 'other');
});
