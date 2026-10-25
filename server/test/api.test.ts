import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildApp, canManage, type Role } from '../src/app.ts';

const T = '11111111-1111-4111-8111-111111111111';
const OWNER = '0b000000-0000-4000-8000-000000000001';
const ADMIN = '0b000000-0000-4000-8000-000000000002';
const STAFF = '0b000000-0000-4000-8000-000000000003';
const ADMIN2 = '0b000000-0000-4000-8000-000000000004';
const CUSTOMER = '0b000000-0000-4000-8000-000000000005';
const NOBODY = '0b000000-0000-4000-8000-000000000009';
const TOKENS: Record<string, string> = { owner: OWNER, admin: ADMIN, staff: STAFF };

type Member = { tenant_id: string; user_id: string; role: Role };
type Invite = { tenant_id: string; email: string; role: Role; invited_by: string; expires_at: string };

// Just enough of the supabase-js query builder for the routes under test.
function fakeSupabase() {
  const members: Member[] = [
    { tenant_id: T, user_id: OWNER, role: 'owner' },
    { tenant_id: T, user_id: ADMIN, role: 'admin' },
    { tenant_id: T, user_id: ADMIN2, role: 'admin' },
    { tenant_id: T, user_id: STAFF, role: 'staff' },
  ];
  const profiles = [
    { id: STAFF, email: 'staff@x.test' },
    { id: ADMIN2, email: 'admin2@x.test' },
    { id: CUSTOMER, email: 'cust@x.test' }, // has an account, not a member
  ];
  const pending: Invite[] = [{ tenant_id: T, email: 'boss@x.test', role: 'admin', invited_by: OWNER, expires_at: '' }];
  const signupEmails: string[] = [];
  const client = {
    auth: {
      getUser: async (token: string) =>
        TOKENS[token]
          ? { data: { user: { id: TOKENS[token] } }, error: null }
          : { data: { user: null }, error: new Error('bad jwt') },
      admin: {
        inviteUserByEmail: async (email: string) => {
          signupEmails.push(email);
          return { data: { user: { id: 'new' } }, error: null };
        },
      },
    },
    from(table: string) {
      const f: Record<string, string> = {};
      let deleting = false;
      const q = {
        select: () => q,
        eq: (k: string, v: string) => ((f[k] = v), q),
        maybeSingle: async () => ({
          data:
            table === 'profiles'
              ? profiles.find(p => p.email === f.email) ?? null
              : table === 'tenant_invites'
                ? pending.find(i => i.tenant_id === f.tenant_id && i.email === f.email) ?? null
                : members.find(m => m.tenant_id === f.tenant_id && m.user_id === f.user_id) ?? null,
          error: null,
        }),
        upsert: async (row: Member | Invite) => {
          if ('email' in row) {
            const i = pending.findIndex(p => p.tenant_id === row.tenant_id && p.email === row.email);
            if (i >= 0) pending[i] = row;
            else pending.push(row);
          } else {
            const i = members.findIndex(m => m.tenant_id === row.tenant_id && m.user_id === row.user_id);
            if (i >= 0) members[i] = row;
            else members.push(row);
          }
          return { error: null };
        },
        delete: () => ((deleting = true), q),
        then(resolve: (v: unknown) => void) {
          if (deleting) members.splice(members.findIndex(m => m.tenant_id === f.tenant_id && m.user_id === f.user_id), 1);
          resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, members, pending, signupEmails };
}

function setup() {
  const fake = fakeSupabase();
  const app = buildApp({ supabase: fake.client, corsOrigins: [], logger: false });
  const call = (method: 'POST' | 'DELETE', url: string, token?: string, payload?: object) =>
    app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { ...fake, app, call };
}

test('canManage role rules', () => {
  assert.equal(canManage('owner', null, 'admin'), true);
  assert.equal(canManage('owner', 'admin'), true);
  assert.equal(canManage('owner', null, 'owner'), false);
  assert.equal(canManage('admin', null, 'staff'), true);
  assert.equal(canManage('admin', null, 'admin'), false);
  assert.equal(canManage('admin', 'admin'), false);
  assert.equal(canManage('admin', 'owner'), false);
  assert.equal(canManage('staff', null, 'staff'), false);
  assert.equal(canManage(null, null, 'staff'), false);
});

test('health and security headers', async () => {
  const { app } = setup();
  const res = await app.inject('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('auth and validation', async () => {
  const { call } = setup();
  assert.equal((await call('POST', `/v1/tenants/${T}/members`, undefined, { email: 'a@x.test', role: 'staff' })).statusCode, 401);
  assert.equal((await call('POST', `/v1/tenants/${T}/members`, 'forged', { email: 'a@x.test', role: 'staff' })).statusCode, 401);
  assert.equal((await call('POST', `/v1/tenants/${T}/members`, 'admin', { email: 'nope', role: 'staff' })).statusCode, 400);
  assert.equal((await call('POST', `/v1/tenants/${T}/members`, 'admin', { email: 'a@x.test', role: 'owner' })).statusCode, 400);
  assert.equal((await call('POST', `/v1/tenants/not-a-uuid/members`, 'admin', { email: 'a@x.test', role: 'staff' })).statusCode, 400);
});

test('a new email gets a pending invite and a sign-up email, not a membership', async () => {
  const { call, signupEmails, pending, members } = setup();
  assert.equal((await call('POST', `/v1/tenants/${T}/members`, 'staff', { email: 'new@x.test', role: 'staff' })).statusCode, 403);
  const res = await call('POST', `/v1/tenants/${T}/members`, 'admin', { email: 'New@X.test', role: 'staff' });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.json(), { ok: true });
  assert.deepEqual(signupEmails, ['new@x.test']);
  const inv = pending.find(i => i.email === 'new@x.test');
  assert.equal(inv?.role, 'staff');
  assert.equal(inv?.invited_by, ADMIN);
  assert.ok(Date.parse(inv!.expires_at) > Date.now());
  assert.equal(members.length, 4);
});

test('an existing account that is not a member only gets a pending invite (consent required)', async () => {
  const { call, signupEmails, pending, members } = setup();
  const res = await call('POST', `/v1/tenants/${T}/members`, 'admin', { email: 'cust@x.test', role: 'staff' });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.json(), { ok: true }); // identical to the new-email response: no enumeration
  assert.deepEqual(signupEmails, []);
  assert.ok(pending.some(i => i.email === 'cust@x.test'));
  assert.ok(!members.some(m => m.user_id === CUSTOMER));
});

test('admins cannot appoint admins, re-role admins, or overwrite an owner\'s admin invite', async () => {
  const { call, signupEmails, pending } = setup();
  assert.equal((await call('POST', `/v1/tenants/${T}/members`, 'admin', { email: 'x@x.test', role: 'admin' })).statusCode, 403);
  assert.equal((await call('POST', `/v1/tenants/${T}/members`, 'admin', { email: 'admin2@x.test', role: 'staff' })).statusCode, 403);
  assert.equal((await call('POST', `/v1/tenants/${T}/members`, 'admin', { email: 'boss@x.test', role: 'staff' })).statusCode, 403);
  assert.equal(pending.find(i => i.email === 'boss@x.test')?.role, 'admin');
  assert.deepEqual(signupEmails, []);
});

test('owner re-roles an existing member directly, without an invite', async () => {
  const { call, signupEmails, pending, members } = setup();
  const res = await call('POST', `/v1/tenants/${T}/members`, 'owner', { email: 'staff@x.test', role: 'admin' });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(signupEmails, []);
  assert.ok(!pending.some(i => i.email === 'staff@x.test'));
  assert.equal(members.find(m => m.user_id === STAFF)?.role, 'admin');
});

test('member changes are rate limited per caller', async () => {
  const { call } = setup();
  for (let i = 0; i < 20; i++) await call('DELETE', `/v1/tenants/${T}/members/${NOBODY}`, 'admin');
  assert.equal((await call('DELETE', `/v1/tenants/${T}/members/${NOBODY}`, 'admin')).statusCode, 429);
  assert.equal((await call('DELETE', `/v1/tenants/${T}/members/${NOBODY}`, 'owner')).statusCode, 404);
});

test('removing members respects rank', async () => {
  const { call, members } = setup();
  assert.equal((await call('DELETE', `/v1/tenants/${T}/members/${OWNER}`, 'admin')).statusCode, 403);
  assert.equal((await call('DELETE', `/v1/tenants/${T}/members/${NOBODY}`, 'admin')).statusCode, 404);
  assert.equal((await call('DELETE', `/v1/tenants/${T}/members/${STAFF}`, 'admin')).statusCode, 204);
  assert.ok(!members.some(m => m.user_id === STAFF));
});
