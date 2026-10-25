// Runs the real migration + seed in embedded Postgres (PGlite) with a minimal
// stand-in for Supabase's auth/storage schemas, then proves the security rules.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../../supabase/', import.meta.url);
const db = new PGlite();

const JAFFNA = '11111111-1111-4111-8111-111111111111';
const COLOMBO = '22222222-2222-4222-8222-222222222222';
const JAFFNA_TOWN = 'a1111111-1111-4111-8111-111111111111';
const NALLUR = 'a2222222-1111-4111-8111-111111111111';
const COLOMBO_03 = 'b1111111-2222-4222-8222-222222222222';
const BANANAS = 'd1111111-1111-4111-8111-111111111111';
const RICE = 'd1111114-1111-4111-8111-111111111111';
const CARROTS = 'd2222221-2222-4222-8222-222222222222';
const COLOMBO_FRESH = 'c2222221-2222-4222-8222-222222222222';

const alice = '0a000000-0000-4000-8000-000000000001'; // customer
const bob = '0a000000-0000-4000-8000-000000000002'; // customer
const jStaff = '0a000000-0000-4000-8000-000000000003';
const jAdmin = '0a000000-0000-4000-8000-000000000004';
const cStaff = '0a000000-0000-4000-8000-000000000005';
const carol = '0a000000-0000-4000-8000-000000000006'; // customer
const dave = '0a000000-0000-4000-8000-000000000007'; // signed up, email not confirmed

const SUPABASE_STUB = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema storage;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to anon, authenticated;
  grant all on storage.objects to authenticated;
`;

async function as<T = Record<string, unknown>>(uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

const placeOrder = (uid: string, store: string, items: object[], fulfilment = 'pickup', address: string | null = null) =>
  as<{ id: string }>(uid, 'select public.place_order($1, $2, $3, $4) as id', [store, fulfilment, JSON.stringify(items), address]).then(r => r[0].id);

const stock = async (store: string, product: string) =>
  (await db.query<{ stock: number }>('select stock from store_products where store_id = $1 and product_id = $2', [store, product])).rows[0].stock;

before(async () => {
  await db.exec(SUPABASE_STUB);
  for (const f of readdirSync(new URL('migrations/', root)).sort()) {
    await db.exec(readFileSync(new URL(`migrations/${f}`, root), 'utf8'));
  }
  await db.exec(readFileSync(new URL('seed.sql', root), 'utf8'));
  for (const [id, email] of [[alice, 'alice@x.test'], [bob, 'bob@x.test'], [jStaff, 'js@x.test'], [jAdmin, 'ja@x.test'], [cStaff, 'cs@x.test'], [carol, 'carol@x.test']]) {
    await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())', [id, email]);
  }
  await db.query(`insert into auth.users (id, email) values ($1, 'dave@x.test')`, [dave]);
  await db.exec(`insert into tenant_members (tenant_id, user_id, role) values
    ('${JAFFNA}', '${jStaff}', 'staff'), ('${JAFFNA}', '${jAdmin}', 'admin'), ('${COLOMBO}', '${cStaff}', 'staff')`);
});

test('signup trigger creates a profile', async () => {
  const rows = await as<{ email: string }>(alice, 'select email from profiles');
  assert.deepEqual(rows, [{ email: 'alice@x.test' }]);
});

test('anon can browse the catalogue but cannot read orders or place them', async () => {
  assert.equal((await as(null, 'select * from tenants')).length, 2);
  assert.ok((await as(null, 'select * from store_products')).length > 0);
  const catalog = await as<{ name: string }>(null, `select name from store_catalog where store_id = '${COLOMBO_03}' order by name`);
  assert.deepEqual(catalog.map(r => r.name), ['Carrots', 'Sourdough loaf']);
  await assert.rejects(as(null, 'select * from orders'), /permission denied/);
  await assert.rejects(as(null, `select place_order('${JAFFNA_TOWN}', 'pickup', '[]')`), /permission denied/);
});

test('order totals come from the database, not the client', async () => {
  const id = await placeOrder(alice, JAFFNA_TOWN, [
    { product_id: BANANAS, quantity: 2, price_cents: 1 }, // client price is ignored
    { product_id: BANANAS, quantity: 1 },
  ]);
  const [o] = await as<{ subtotal_cents: number; total_cents: number }>(alice, 'select * from orders where id = $1', [id]);
  assert.equal(o.subtotal_cents, 450 * 3);
  assert.equal(o.total_cents, 450 * 3);
  assert.equal(await stock(JAFFNA_TOWN, BANANAS), 97);
});

test('cannot oversell; a failed order leaves no trace', async () => {
  const before = (await db.query('select count(*)::int as n from orders')).rows[0];
  await assert.rejects(placeOrder(alice, JAFFNA_TOWN, [{ product_id: RICE, quantity: 11 }]), /out of stock/);
  assert.equal(await stock(JAFFNA_TOWN, RICE), 10);
  assert.deepEqual((await db.query('select count(*)::int as n from orders')).rows[0], before);
});

test('cannot order another tenant\'s product from this store', async () => {
  await assert.rejects(placeOrder(alice, JAFFNA_TOWN, [{ product_id: CARROTS, quantity: 1 }]), /unavailable/);
});

test('delivery rules: store must deliver, address must be your own, min order applies', async () => {
  const [addr] = await as<{ id: string }>(alice,
    `insert into addresses (line1, suburb, state, postcode) values ('1 Main St', 'Jaffna', 'NP', '40000') returning id`);
  await assert.rejects(placeOrder(alice, NALLUR, [{ product_id: BANANAS, quantity: 1 }], 'delivery', addr.id), /does not deliver/);
  await assert.rejects(placeOrder(bob, JAFFNA_TOWN, [{ product_id: RICE, quantity: 1 }], 'delivery', addr.id), /delivery address/);
  await assert.rejects(placeOrder(alice, JAFFNA_TOWN, [{ product_id: BANANAS, quantity: 1 }], 'delivery', addr.id), /Minimum order/);
  const id = await placeOrder(alice, JAFFNA_TOWN, [{ product_id: RICE, quantity: 1 }], 'delivery', addr.id);
  const [o] = await as<{ total_cents: number }>(alice, 'select total_cents from orders where id = $1', [id]);
  assert.equal(o.total_cents, 2900 + 300);
  assert.equal((await as(bob, 'select * from addresses')).length, 0);
});

test('clients cannot write orders or membership directly', async () => {
  await assert.rejects(as(alice, `insert into orders (tenant_id, store_id, user_id, fulfilment) values ('${JAFFNA}', '${JAFFNA_TOWN}', '${alice}', 'pickup')`), /permission denied/);
  await assert.rejects(as(alice, `update orders set total_cents = 0`), /permission denied/);
  await assert.rejects(as(alice, `insert into tenant_members values ('${JAFFNA}', '${alice}', 'owner')`), /permission denied/);
  assert.equal((await as(alice, `update store_products set price_cents = 1 returning 1`)).length, 0);
});

test('tenant isolation for staff', async () => {
  await placeOrder(bob, COLOMBO_03, [{ product_id: CARROTS, quantity: 3 }]);
  const jOrders = await as<{ tenant_id: string }>(jStaff, 'select tenant_id from orders');
  assert.ok(jOrders.length > 0 && jOrders.every(o => o.tenant_id === JAFFNA));
  const cOrders = await as<{ tenant_id: string }>(cStaff, 'select tenant_id from orders');
  assert.ok(cOrders.length > 0 && cOrders.every(o => o.tenant_id === COLOMBO));

  assert.equal((await as(jStaff, `update store_products set stock = 0 where store_id = '${COLOMBO_03}' returning 1`)).length, 0);
  assert.equal((await as(jStaff, `update store_products set stock = 5 where store_id = '${JAFFNA_TOWN}' and product_id = '${RICE}' returning 1`)).length, 1);
  await assert.rejects(as(jStaff, `update store_products set tenant_id = '${COLOMBO}'`), /permission denied/);
  await assert.rejects(as(jAdmin, `insert into products (tenant_id, name) values ('${COLOMBO}', 'x')`), /row-level security/);
  await assert.rejects(as(jAdmin, `insert into products (tenant_id, category_id, name) values ('${JAFFNA}', '${COLOMBO_FRESH}', 'x')`), /foreign key/);
  assert.equal((await as(jAdmin, `insert into products (tenant_id, name) values ('${JAFFNA}', 'Mangoes') returning 1`)).length, 1);
  await assert.rejects(as(jStaff, `insert into products (tenant_id, name) values ('${JAFFNA}', 'x')`), /row-level security/);
});

test('staff see profiles of their own customers only', async () => {
  const seen = (uid: string) => as<{ email: string }>(uid, 'select email from profiles order by email').then(r => r.map(p => p.email));
  assert.ok((await seen(jStaff)).includes('alice@x.test'));
  assert.ok(!(await seen(jStaff)).includes('bob@x.test'));
  assert.ok((await seen(cStaff)).includes('bob@x.test'));
  assert.ok(!(await seen(cStaff)).includes('alice@x.test'));
  assert.deepEqual(await seen(bob), ['bob@x.test']);
});

test('order status machine', async () => {
  const set = (uid: string, id: string, s: string) => as(uid, 'select set_order_status($1, $2)', [id, s]);

  const a = await placeOrder(alice, JAFFNA_TOWN, [{ product_id: BANANAS, quantity: 5 }]);
  const stockAfterOrder = await stock(JAFFNA_TOWN, BANANAS);
  await assert.rejects(set(alice, a, 'confirmed'), /Not allowed/);
  await assert.rejects(set(bob, a, 'cancelled'), /Not allowed/);
  await assert.rejects(set(cStaff, a, 'confirmed'), /Not allowed/);
  await set(alice, a, 'cancelled');
  assert.equal(await stock(JAFFNA_TOWN, BANANAS), stockAfterOrder + 5);
  await assert.rejects(set(jStaff, a, 'confirmed'), /Cannot move/);

  const b = await placeOrder(alice, JAFFNA_TOWN, [{ product_id: BANANAS, quantity: 1 }]);
  await assert.rejects(set(jStaff, b, 'completed'), /Cannot move/);
  await set(jStaff, b, 'confirmed');
  await assert.rejects(set(alice, b, 'cancelled'), /Not allowed/);
  await set(jStaff, b, 'preparing');
  await assert.rejects(set(jStaff, b, 'out_for_delivery'), /Cannot move/); // pickup order
  await set(jStaff, b, 'ready');
  await set(jStaff, b, 'completed');
});

test('a customer can hold at most 5 pending orders', async () => {
  for (let i = 0; i < 5; i++) await placeOrder(carol, JAFFNA_TOWN, [{ product_id: BANANAS, quantity: 1 }]);
  await assert.rejects(placeOrder(carol, JAFFNA_TOWN, [{ product_id: BANANAS, quantity: 1 }]), /too many orders/);
});

test('unknown order ids look the same as other people\'s orders', async () => {
  await assert.rejects(as(carol, `select set_order_status('${carol}', 'cancelled')`), /Not allowed/);
});

test('unavailable store products are hidden from the public but not from staff', async () => {
  await db.query(`update store_products set is_available = false where store_id = $1 and product_id = $2`, [JAFFNA_TOWN, RICE]);
  const visible = (uid: string | null) =>
    as(uid, `select 1 from store_products where store_id = '${JAFFNA_TOWN}' and product_id = '${RICE}'`).then(r => r.length);
  assert.equal(await visible(null), 0);
  assert.equal(await visible(alice), 0);
  assert.equal(await visible(jStaff), 1);
  assert.equal(await visible(cStaff), 0);
});

test('product images: admins upload only into their own tenant folder', async () => {
  await assert.rejects(as(jAdmin, `insert into storage.objects (bucket_id, name) values ('product-images', '${COLOMBO}/a.png')`), /row-level security/);
  await assert.rejects(as(jStaff, `insert into storage.objects (bucket_id, name) values ('product-images', '${JAFFNA}/a.png')`), /row-level security/);
  assert.equal((await as(jAdmin, `insert into storage.objects (bucket_id, name) values ('product-images', '${JAFFNA}/a.png') returning 1`)).length, 1);
});

// The Node API writes invites with the service role; tests insert them directly.
const invite = (tenant: string, email: string, role: string, expires = "now() + interval '1 day'") =>
  db.query(`insert into tenant_invites (tenant_id, email, role, expires_at) values ($1, $2, $3, ${expires})`, [tenant, email, role]);
const roleIn = async (tenant: string, user: string) =>
  (await db.query<{ role: string }>('select role from tenant_members where tenant_id = $1 and user_id = $2', [tenant, user])).rows[0]?.role;

test('invites become memberships only when the confirmed email owner accepts', async () => {
  await invite(JAFFNA, 'carol@x.test', 'staff');
  await invite(JAFFNA, 'dave@x.test', 'staff');
  await invite(COLOMBO, 'carol@x.test', 'admin');

  await assert.rejects(as(jAdmin, `insert into tenant_invites (tenant_id, email, role) values ('${JAFFNA}', 'x@x.test', 'admin')`), /permission denied/);
  const seenBy = (uid: string) => as<{ email: string }>(uid, 'select email from tenant_invites order by tenant_id, email').then(r => r.map(i => i.email));
  assert.deepEqual(await seenBy(jAdmin), ['carol@x.test', 'dave@x.test']);
  assert.deepEqual(await seenBy(carol), ['carol@x.test', 'carol@x.test']);
  assert.deepEqual(await seenBy(bob), []);
  assert.deepEqual(await seenBy(dave), []); // unconfirmed email can't even see it

  assert.equal(await roleIn(JAFFNA, carol), undefined); // invite alone grants nothing
  await assert.rejects(as(dave, `select accept_invite('${JAFFNA}')`), /Confirm your email/);
  await assert.rejects(as(bob, `select accept_invite('${JAFFNA}')`), /not found/);
  assert.deepEqual(await as(carol, `select accept_invite('${JAFFNA}') as role`), [{ role: 'staff' }]);
  assert.equal(await roleIn(JAFFNA, carol), 'staff');
  await assert.rejects(as(carol, `select accept_invite('${JAFFNA}')`), /not found/); // single use

  assert.equal((await as(carol, `delete from tenant_invites where tenant_id = '${COLOMBO}' returning 1`)).length, 1); // decline
  assert.equal(await roleIn(COLOMBO, carol), undefined);
});

test('invites expire, never demote, and are revoked by rank', async () => {
  await invite(COLOMBO, 'bob@x.test', 'staff', "now() - interval '1 minute'");
  await assert.rejects(as(bob, `select accept_invite('${COLOMBO}')`), /not found or expired/);

  await invite(JAFFNA, 'ja@x.test', 'staff');
  assert.deepEqual(await as(jAdmin, `select accept_invite('${JAFFNA}') as role`), [{ role: 'admin' }]);
  assert.equal(await roleIn(JAFFNA, jAdmin), 'admin');

  await invite(JAFFNA, 's1@x.test', 'staff');
  await invite(JAFFNA, 'a1@x.test', 'admin');
  const revoked = await as<{ email: string }>(jAdmin, `delete from tenant_invites where tenant_id = '${JAFFNA}' and email in ('s1@x.test', 'a1@x.test') returning email`);
  assert.deepEqual(revoked.map(r => r.email), ['s1@x.test']); // admins can't revoke an owner's admin invite
  assert.equal((await as(jStaff, `delete from tenant_invites returning 1`)).length, 0);
});
