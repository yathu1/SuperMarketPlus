# SuperMarketPlus

Multi-tenant grocery e-commerce for food cities in Malaysia. One customer app serves every tenant: shoppers pick their food city and store, then browse, order for pickup or delivery, and pay on fulfilment. Each tenant's owners and staff run their own catalogue, stores, orders and team from a web admin.

```
 Mobile app (React Native) ─┐   anon key + user JWT     ┌─ Postgres + RLS  (tenant isolation, order RPCs)
 Web admin  (React + Vite) ─┼──────────────────────────► │  Auth            (email + password)
                            │                           └─ Storage         (product-images/<tenant_id>/…)
                            └─► Node API (Fastify) ── service role ──► staff invites / removal only
```

| Folder | What | Run |
|---|---|---|
| `supabase/` | Schema, RLS, order functions, seed (2 Malaysian demo food cities) | `npx supabase start` (needs Docker) |
| `server/` | Node API + all backend tests | `npm test`, `npm run dev` |
| `/` (root) | React Native app | `npm start`, `npm run android` / `ios` |
| `admin/` | Web admin for owners/admins/staff | `npm run dev` |

## Security model

- **RLS is the tenant boundary.** Every business row has `tenant_id`, and composite foreign keys `(tenant_id, id)` make cross-tenant references impossible. Clients only ever hold the anon key, so a bug in client code can't reach another tenant's data.
- **Roles per tenant** are `owner`, `admin` and `staff`, stored in `tenant_members`. Customers need no membership row. Clients can't write `tenant_members` at all. Owners invite admins and staff, admins invite staff, and ownership is never granted by the API. Joining needs the invitee's consent: the Node API writes a 14-day `tenant_invites` row, and only someone signed in with that **confirmed** email can turn it into a membership (`accept_invite()`, from the banner in the admin). Existing members are re-roled directly.
- **Money and stock are server-side.** `place_order()` prices every line from the database, applies fees and minimums, and decrements stock atomically, so concurrent orders can't oversell. Clients can't insert or update orders. Status changes go through `set_order_status()`, a single state machine that restocks on cancel.
- **Column-level grants.** Staff can change only price, stock and availability. Customers can edit only their own name and phone.
- **Sessions** are stored in the iOS Keychain or Android Keystore. Only public catalogue data is cached on disk (MMKV), and per-user queries are dropped on sign-out.
- **Auth policy:** email confirmation is required, passwords must be at least 10 characters with letters and digits, refresh-token rotation is on, and changing a password requires reauthentication. See `supabase/config.toml`, and set the same values in the hosted project's Auth settings.
- **Abuse limits:** a customer can have at most 5 pending orders. The member API gives the same response whether or not an email has an account, and is limited to 20 changes per hour per caller.
- **API hardening:** helmet, CORS allow-list, rate limit (60 requests per minute per IP), 16 KB body limit, zod validation, authorization header redacted from logs, and 5xx details hidden from clients.

`server/test/db.test.ts` runs the real migration and seed in embedded Postgres (PGlite) and proves the following: anon access is read-only, totals come from the server, stock can't be oversold, staff can't reach another tenant's orders, stock, products or images, privilege escalation is blocked, and the order state machine is enforced.

## Performance

- Hermes engine (React Native's default).
- FlashList grid. Each product card subscribes only to its own cart line, so changing a quantity re-renders one card.
- TanStack Query cache persisted to MMKV, so the catalogue renders instantly on relaunch and refreshes in the background.
- `store_catalog` view, so the shop screen pages through products with one indexed query of 40 rows per page. Search is debounced.
- Supabase image transforms for thumbnails in production (`IMAGE_TRANSFORMS` in `src/config.ts`).

## Local setup

1. **Database:** start Docker, then run:
   ```bash
   npx supabase start
   ```
   It applies the migration and the seed, and prints the API URL, the anon key and the service-role key.
2. **API:**
   ```bash
   cd server && cp .env.example .env
   ```
   Fill in `SUPABASE_SERVICE_ROLE_KEY`, then run `npm run dev`.
3. **Admin:**
   ```bash
   cd admin && cp .env.example .env.local
   ```
   Fill in the anon key, then run `npm run dev` (it serves on http://localhost:5173).
4. **Mobile:** put the anon key in `src/config.ts`, then run `npm start` and `npm run android` (or `cd ios && bundle exec pod install && cd .. && npm run ios`).
5. **First owner:** sign up in the app, then confirm the email from the local mail catcher (http://127.0.0.1:54324). In Supabase Studio (http://127.0.0.1:54323), run:
   ```sql
   insert into tenant_members (tenant_id, user_id, role)
   select '11111111-1111-4111-8111-111111111111', id, 'owner' from auth.users where email = 'you@example.com';
   ```
   After that, invite everyone else from the admin's Team page. New people get a Supabase invite email: the link signs them in to the admin, asks them to set a password, and shows the invite to accept. People who already have an account see the invite banner the next time they sign in to the admin. Nothing emails them yet, so tell them.

New food city: insert a row into `tenants`, add stores, and grant an owner as above.

## Checks

```bash
cd server && npm test && npm run typecheck   # DB security + API tests
npx tsc --noEmit && npx jest && npx eslint . # mobile
cd admin && npm run build                    # admin typecheck + build
```

## Malaysia defaults

- **Currency:** each tenant row has a `currency`. Use `MYR`; prices are stored in sen, and both apps format them with the `en-MY` locale (`RM 12.50`).
- **Addresses:** the app requires a 5-digit postcode and asks for city and state (for example Selangor). The database check stays generic in case a tenant ever opens outside Malaysia.
- **Seed data:** the demo food cities are KL (Bangsar, Petaling Jaya) and Penang (George Town). They're for local development and tests only, and are never pushed to the cloud project.
- **Hosting:** keep the Supabase project in **Singapore (ap-southeast-1)** for low latency.
- **Before launch:** a PDPA (Personal Data Protection Act 2010) privacy notice. Most basic groceries are SST-exempt, so there's no tax calculation yet.
- **Language:** English only for now.

## Not built yet (deliberately)

Online payments (orders are pay on pickup or delivery; FPX, DuitNow QR, Touch 'n Go and GrabPay would come via Billplz, iPay88 or Stripe), push notifications, realtime order updates (the admin polls every 15 seconds), delivery slots and tracking, promotions, a platform super-admin for creating tenants (use SQL for now), generated DB types (`supabase gen types`), and CI.
