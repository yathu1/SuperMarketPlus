-- SuperMarketPlus: multi-tenant grocery schema.
-- Every business row carries tenant_id; RLS is the isolation boundary.
-- Composite FKs (tenant_id, id) make cross-tenant references impossible at the DB level.

create type public.member_role as enum ('owner', 'admin', 'staff');
create type public.fulfilment_type as enum ('pickup', 'delivery');
create type public.order_status as enum (
  'pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'
);

-- ---------------------------------------------------------------- tables

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (length(name) between 1 and 120),
  logo_path text,
  primary_color text check (primary_color ~ '^#[0-9a-fA-F]{6}$'),
  currency text not null check (currency ~ '^[A-Z]{3}$'), -- ISO 4217; all *_cents columns are in this currency
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete cascade,
  name text not null check (length(name) between 1 and 120),
  address text not null,
  phone text,
  offers_delivery boolean not null default true,
  delivery_fee_cents int not null default 0 check (delivery_fee_cents >= 0),
  min_order_cents int not null default 0 check (min_order_cents >= 0), -- delivery orders only
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text check (length(full_name) <= 120),
  phone text check (length(phone) <= 30),
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role public.member_role not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index on public.tenant_members (user_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete cascade,
  name text not null check (length(name) between 1 and 80),
  sort_order int not null default 0,
  unique (tenant_id, name),
  unique (tenant_id, id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants on delete cascade,
  category_id uuid,
  name text not null check (length(name) between 1 and 160),
  description text check (length(description) <= 2000),
  unit text not null default 'each' check (unit in ('each', 'kg', 'g', 'l', 'ml', 'pack')),
  image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references public.categories (tenant_id, id) on delete set null (category_id)
);
-- ponytail: ilike scan per tenant is fine to ~50k products; add pg_trgm GIN on name beyond that.
create index on public.products (tenant_id, category_id, name);

create table public.store_products (
  tenant_id uuid not null,
  store_id uuid not null,
  product_id uuid not null,
  price_cents int not null check (price_cents >= 0),
  stock int not null default 0 check (stock >= 0),
  is_available boolean not null default true,
  primary key (store_id, product_id),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade
);
create index on public.store_products (product_id);

-- What a shopper sees in one store. security_invoker keeps the caller's RLS in force.
create view public.store_catalog with (security_invoker = true) as
  select sp.tenant_id, sp.store_id, p.id as product_id, p.category_id, p.name, p.description,
         p.unit, p.image_path, sp.price_cents, sp.stock
  from public.store_products sp
  join public.products p on p.id = sp.product_id and p.tenant_id = sp.tenant_id
  where sp.is_available and p.is_active;

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  label text check (length(label) <= 40),
  line1 text not null check (length(line1) between 1 and 200),
  line2 text check (length(line2) <= 200),
  suburb text not null check (length(suburb) between 1 and 80),
  state text not null check (length(state) between 1 and 40),
  postcode text not null check (postcode ~ '^[0-9A-Za-z -]{3,10}$'),
  instructions text check (length(instructions) <= 300),
  created_at timestamptz not null default now()
);
create index on public.addresses (user_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  store_id uuid not null,
  user_id uuid not null references auth.users on delete restrict,
  status public.order_status not null default 'pending',
  fulfilment public.fulfilment_type not null,
  delivery_address jsonb,
  notes text check (length(notes) <= 500),
  payment_method text not null default 'cash_on_fulfilment' check (payment_method = 'cash_on_fulfilment'),
  subtotal_cents int not null default 0 check (subtotal_cents >= 0),
  delivery_fee_cents int not null default 0 check (delivery_fee_cents >= 0),
  total_cents int not null default 0 check (total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete restrict,
  check ((fulfilment = 'delivery') = (delivery_address is not null))
);
create index on public.orders (user_id, created_at desc);
create index on public.orders (tenant_id, status, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders on delete cascade,
  product_id uuid not null references public.products on delete restrict,
  product_name text not null,
  unit_price_cents int not null check (unit_price_cents >= 0),
  quantity int not null check (quantity between 1 and 99),
  line_total_cents int generated always as (unit_price_cents * quantity) stored
);
create index on public.order_items (order_id);

-- ---------------------------------------------------------------- helpers

-- SECURITY DEFINER so policies can consult tenant_members without recursing into its own RLS.
create function public.has_tenant_role(p_tenant uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant and user_id = auth.uid() and role = any (p_roles)
  );
$$;

create function public.is_tenant_staff(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_tenant_role(p_tenant, '{owner,admin,staff}');
$$;

create function public.is_tenant_admin(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_tenant_role(p_tenant, '{owner,admin}');
$$;

-- Admins see profiles of their tenant's members; staff see profiles of customers who ordered there.
create function public.can_view_profile(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid()
    or exists (
      select 1 from public.tenant_members m
      where m.user_id = p_user and public.is_tenant_admin(m.tenant_id)
    )
    or exists (
      select 1 from public.orders o
      where o.user_id = p_user and public.is_tenant_staff(o.tenant_id)
    );
$$;

create function public.handle_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_saved
  after insert or update of email on auth.users
  for each row execute function public.handle_auth_user();

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS

alter table public.tenants enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.tenant_members enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.store_products enable row level security;
alter table public.addresses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Catalogue: public read of active rows, staff read everything in their tenant.
create policy tenants_read on public.tenants for select
  using (is_active or public.is_tenant_staff(id));
create policy tenants_owner_update on public.tenants for update to authenticated
  using (public.has_tenant_role(id, '{owner}'));

create policy stores_read on public.stores for select
  using (is_active or public.is_tenant_staff(tenant_id));
create policy stores_admin_write on public.stores for all to authenticated
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

create policy categories_read on public.categories for select using (true);
create policy categories_admin_write on public.categories for all to authenticated
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

create policy products_read on public.products for select
  using (is_active or public.is_tenant_staff(tenant_id));
create policy products_admin_write on public.products for all to authenticated
  using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id));

-- Staff manage price/stock; admins can also add or remove a product from a store.
create policy store_products_read on public.store_products for select
  using (is_available or public.is_tenant_staff(tenant_id));
create policy store_products_staff_update on public.store_products for update to authenticated
  using (public.is_tenant_staff(tenant_id)) with check (public.is_tenant_staff(tenant_id));
create policy store_products_admin_insert on public.store_products for insert to authenticated
  with check (public.is_tenant_admin(tenant_id));
create policy store_products_admin_delete on public.store_products for delete to authenticated
  using (public.is_tenant_admin(tenant_id));

-- People.
create policy profiles_read on public.profiles for select to authenticated
  using (public.can_view_profile(id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Membership changes go through the Node API (service role); clients can only read.
create policy members_read on public.tenant_members for select to authenticated
  using (user_id = auth.uid() or public.is_tenant_admin(tenant_id));

create policy addresses_own on public.addresses for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Orders: read-only to clients; writes only via place_order / set_order_status.
create policy orders_read on public.orders for select to authenticated
  using (user_id = auth.uid() or public.is_tenant_staff(tenant_id));
create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- Column-level hardening on top of RLS.
revoke all on public.orders, public.order_items, public.tenant_members from anon, authenticated;
grant select on public.orders, public.order_items, public.tenant_members to authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone) on public.profiles to authenticated;
revoke update on public.tenants from anon, authenticated;
grant update (name, logo_path, primary_color) on public.tenants to authenticated;
revoke insert, delete on public.tenants from anon, authenticated;
revoke update on public.store_products from anon, authenticated;
grant update (price_cents, stock, is_available) on public.store_products to authenticated;

-- ---------------------------------------------------------------- order RPCs

-- Prices, fees and stock are resolved here, never trusted from the client.
-- p_items: [{"product_id": uuid, "quantity": int}, ...]
create function public.place_order(
  p_store_id uuid,
  p_fulfilment public.fulfilment_type,
  p_items jsonb,
  p_address_id uuid default null,
  p_notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_store public.stores;
  v_address jsonb;
  v_fee int := 0;
  v_subtotal int := 0;
  v_order_id uuid;
  v_line record;
  v_price int;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Sign in to place an order' using errcode = '28000';
  end if;

  select s.* into v_store from public.stores s
    join public.tenants t on t.id = s.tenant_id
    where s.id = p_store_id and s.is_active and t.is_active;
  if not found then
    raise exception 'Store is not available' using errcode = 'P0002';
  end if;

  -- Stops one account from reserving a store's stock with unlimited pay-later orders.
  if (select count(*) from public.orders where user_id = v_uid and status = 'pending') >= 5 then
    raise exception 'You have too many orders awaiting confirmation' using errcode = '54000';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Cart must have between 1 and 100 items' using errcode = '22023';
  end if;

  if p_fulfilment = 'delivery' then
    if not v_store.offers_delivery then
      raise exception 'This store does not deliver' using errcode = '22023';
    end if;
    select jsonb_build_object(
             'label', a.label, 'line1', a.line1, 'line2', a.line2, 'suburb', a.suburb,
             'state', a.state, 'postcode', a.postcode, 'instructions', a.instructions)
      into v_address
      from public.addresses a where a.id = p_address_id and a.user_id = v_uid;
    if v_address is null then
      raise exception 'Choose a delivery address' using errcode = '22023';
    end if;
    v_fee := v_store.delivery_fee_cents;
  end if;

  insert into public.orders (tenant_id, store_id, user_id, fulfilment, delivery_address, notes, delivery_fee_cents)
  values (v_store.tenant_id, v_store.id, v_uid, p_fulfilment, v_address, nullif(trim(p_notes), ''), v_fee)
  returning id into v_order_id;

  -- Merge duplicate lines; order by product to keep row-lock order deterministic (no deadlocks).
  for v_line in
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::int) as qty
    from jsonb_array_elements(p_items) e
    group by 1 order by 1
  loop
    if v_line.qty is null or v_line.qty not between 1 and 99 then
      raise exception 'Quantity must be between 1 and 99' using errcode = '22023';
    end if;

    -- Conditional decrement is atomic: concurrent orders cannot oversell.
    update public.store_products sp
      set stock = sp.stock - v_line.qty
      from public.products p
      where sp.store_id = v_store.id and sp.product_id = v_line.product_id
        and p.id = sp.product_id and p.is_active and sp.is_available
        and sp.stock >= v_line.qty
      returning sp.price_cents, p.name into v_price, v_name;
    if not found then
      raise exception 'An item in your cart is out of stock or unavailable'
        using errcode = 'P0001', detail = v_line.product_id::text;
    end if;

    insert into public.order_items (order_id, product_id, product_name, unit_price_cents, quantity)
    values (v_order_id, v_line.product_id, v_name, v_price, v_line.qty);
    v_subtotal := v_subtotal + v_price * v_line.qty;
  end loop;

  if p_fulfilment = 'delivery' and v_subtotal < v_store.min_order_cents then
    raise exception 'Minimum order for delivery is %', to_char(v_store.min_order_cents / 100.0, 'FM999990.00')
      using errcode = '22023';
  end if;

  update public.orders
    set subtotal_cents = v_subtotal, total_cents = v_subtotal + v_fee
    where id = v_order_id;
  return v_order_id;
end;
$$;

-- Single place for the order state machine. Staff move orders forward;
-- customers may only cancel their own pending order. Cancelling restocks.
create function public.set_order_status(p_order_id uuid, p_status public.order_status)
returns public.order_status language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_is_staff boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  v_is_staff := found and public.is_tenant_staff(v_order.tenant_id);
  -- Same error for "no such order" and "not yours", so ids can't be probed.
  if not v_is_staff and not coalesce(v_order.user_id = auth.uid() and v_order.status = 'pending' and p_status = 'cancelled', false) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if (v_order.status::text, p_status::text) not in (
    ('pending', 'confirmed'), ('pending', 'cancelled'),
    ('confirmed', 'preparing'), ('confirmed', 'cancelled'),
    ('preparing', 'ready'), ('preparing', 'out_for_delivery'), ('preparing', 'cancelled'),
    ('ready', 'completed'), ('out_for_delivery', 'completed')
  ) or (p_status = 'out_for_delivery' and v_order.fulfilment <> 'delivery')
    or (p_status = 'ready' and v_order.fulfilment <> 'pickup') then
    raise exception 'Cannot move order from % to %', v_order.status, p_status using errcode = '22023';
  end if;

  if p_status = 'cancelled' then
    update public.store_products sp
      set stock = sp.stock + oi.quantity
      from public.order_items oi
      where oi.order_id = v_order.id and sp.store_id = v_order.store_id and sp.product_id = oi.product_id;
  end if;

  update public.orders set status = p_status where id = v_order.id;
  return p_status;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.place_order, public.set_order_status to authenticated;
grant execute on function public.has_tenant_role, public.is_tenant_staff, public.is_tenant_admin,
  public.can_view_profile to authenticated;
-- Public catalogue policies call is_tenant_staff for anon too (returns false without a uid).
grant execute on function public.has_tenant_role, public.is_tenant_staff to anon;

-- ---------------------------------------------------------------- storage

-- Product images live at product-images/<tenant_id>/<file>; public read, admin write.
create policy product_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images'
    and public.is_tenant_admin(((storage.foldername(name))[1])::uuid));
create policy product_images_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'product-images'
    and public.is_tenant_admin(((storage.foldername(name))[1])::uuid));
create policy product_images_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-images'
    and public.is_tenant_admin(((storage.foldername(name))[1])::uuid));
