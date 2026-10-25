-- Staff invitations need the invitee's consent: the Node API writes a pending invite,
-- and only the owner of the (confirmed) email can turn it into a membership.

create table public.tenant_invites (
  tenant_id uuid not null references public.tenants on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 254),
  role public.member_role not null check (role <> 'owner'),
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  primary key (tenant_id, email)
);
create index on public.tenant_invites (email);

-- The caller's email, but only once they have proven they own it.
create function public.confirmed_email()
returns text language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null;
$$;

alter table public.tenant_invites enable row level security;

create policy invites_read on public.tenant_invites for select to authenticated
  using (public.is_tenant_admin(tenant_id) or email = public.confirmed_email());
-- Invitees can decline; admins can revoke staff invites, only owners can revoke admin invites.
create policy invites_delete on public.tenant_invites for delete to authenticated
  using (
    email = public.confirmed_email()
    or (role = 'staff' and public.is_tenant_admin(tenant_id))
    or public.has_tenant_role(tenant_id, '{owner}')
  );

revoke all on public.tenant_invites from anon, authenticated;
grant select, delete on public.tenant_invites to authenticated;

create function public.accept_invite(p_tenant_id uuid)
returns public.member_role language plpgsql security definer set search_path = '' as $$
declare
  v_email text := public.confirmed_email();
  v_role public.member_role;
  v_current public.member_role;
begin
  if v_email is null then
    raise exception 'Confirm your email address before accepting an invite' using errcode = '42501';
  end if;

  delete from public.tenant_invites
    where tenant_id = p_tenant_id and email = v_email and expires_at > now()
    returning role into v_role;
  if not found then
    raise exception 'Invite not found or expired' using errcode = 'P0002';
  end if;

  -- Enum order is owner < admin < staff, so "<=" means "same or more senior": never demote via an invite.
  select role into v_current from public.tenant_members where tenant_id = p_tenant_id and user_id = auth.uid();
  if v_current is not null and v_current <= v_role then
    return v_current;
  end if;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (p_tenant_id, auth.uid(), v_role)
  on conflict (tenant_id, user_id) do update set role = excluded.role;
  return v_role;
end;
$$;

revoke execute on function public.confirmed_email, public.accept_invite from public, anon;
grant execute on function public.confirmed_email, public.accept_invite to authenticated;
