import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { arrivedVia, run, supabase, type Membership } from './lib';
import { Orders } from './pages/Orders';
import { Products } from './pages/Products';
import { Stores } from './pages/Stores';
import { Team } from './pages/Team';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>();
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  if (session === undefined) return null;
  if (!session) return <Login />;
  return (
    <>
      {(arrivedVia === 'invite' || arrivedVia === 'recovery') && <SetPassword />}
      <Console userId={session.user.id} email={session.user.email ?? ''} />
    </>
  );
}

// People who arrive from an invite or reset email have a session but no password yet.
function SetPassword() {
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { error: err } = await supabase.auth.updateUser({ password });
    setError(err?.message ?? null);
    if (!err) setDone(true);
  };

  if (done) return null;
  return (
    <form className="banner" onSubmit={submit}>
      <strong>Set a password so you can sign in next time.</strong>
      <input type="password" autoComplete="new-password" required minLength={10} value={password} onChange={e => setPassword(e.target.value)} aria-label="New password" />
      <button>Save password</button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

type PendingInvite = { tenant_id: string; role: Membership['role']; tenant: { name: string } | null };

// Invites addressed to the signed-in user's confirmed email (RLS hides them until it is confirmed).
function InviteBanner({ email, onAccepted }: { email: string; onAccepted: (tenantId: string) => void }) {
  const qc = useQueryClient();
  const invites = useQuery({
    queryKey: ['my-invites', email],
    queryFn: () =>
      run<PendingInvite[]>(
        supabase
          .from('tenant_invites')
          .select('tenant_id, role, tenant:tenants(name)')
          .eq('email', email.toLowerCase())
          .gt('expires_at', new Date().toISOString()),
      ),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['my-invites'] });
    qc.invalidateQueries({ queryKey: ['memberships'] });
  };
  const accept = useMutation({
    mutationFn: (tenantId: string) => run(supabase.rpc('accept_invite', { p_tenant_id: tenantId })),
    onSuccess: (_role, tenantId) => {
      refresh();
      onAccepted(tenantId);
    },
  });
  const decline = useMutation({
    mutationFn: (tenantId: string) => run(supabase.from('tenant_invites').delete().eq('tenant_id', tenantId).eq('email', email.toLowerCase())),
    onSuccess: refresh,
  });

  if (!invites.data?.length) return null;
  return (
    <div className="banner" role="status">
      {invites.data.map(i => (
        <div key={i.tenant_id} className="toolbar">
          <span>
            You've been invited to join <strong>{i.tenant?.name ?? 'a food city'}</strong> as <strong>{i.role}</strong>.
          </span>
          <button disabled={accept.isPending} onClick={() => accept.mutate(i.tenant_id)}>
            Accept
          </button>
          <button className="link" disabled={decline.isPending} onClick={() => decline.mutate(i.tenant_id)}>
            Decline
          </button>
        </div>
      ))}
      {(accept.error || decline.error) && <p className="error">{(accept.error ?? decline.error)!.message}</p>}
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    setError(err?.message ?? null);
  };

  return (
    <form className="login card" onSubmit={submit}>
      <h1>SuperMarketPlus Admin</h1>
      <label>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

const TABS = ['orders', 'products', 'stores', 'team'] as const;
type Tab = (typeof TABS)[number];

function Console({ userId, email }: { userId: string; email: string }) {
  const [tenantId, setTenantId] = useState<string>();
  const [tab, setTab] = useState<Tab>('orders');
  const memberships = useQuery({
    queryKey: ['memberships', userId],
    queryFn: () =>
      run<Membership[]>(
        supabase.from('tenant_members').select('role, tenant:tenants(id, name, currency, primary_color)').eq('user_id', userId),
      ),
  });

  const banner = <InviteBanner email={email} onAccepted={setTenantId} />;
  if (memberships.isPending) return <p className="pad">Loading…</p>;
  const m = memberships.data?.find(x => x.tenant.id === tenantId) ?? memberships.data?.[0];
  if (!m) {
    return (
      <div className="pad">
        {banner}
        <p>
          {memberships.error?.message ??
            'Your account has no food city access yet. Ask an owner or admin to invite you, then confirm your email to see the invite here.'}
        </p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    );
  }
  const isAdmin = m.role !== 'staff';
  const tabs = TABS.filter(t => isAdmin || t === 'orders' || t === 'products');

  return (
    <div style={{ ['--brand' as string]: m.tenant.primary_color ?? '#1B7F3B' }}>
      <header className="topbar">
        <select aria-label="Food city" value={m.tenant.id} onChange={e => setTenantId(e.target.value)}>
          {memberships.data!.map(x => (
            <option key={x.tenant.id} value={x.tenant.id}>
              {x.tenant.name}
            </option>
          ))}
        </select>
        <nav>
          {tabs.map(t => (
            <button key={t} className={t === tab ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
        <span className="muted">{m.role}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <main className="pad" key={m.tenant.id}>
        {banner}
        {tab === 'orders' && <Orders m={m} />}
        {tab === 'products' && <Products m={m} isAdmin={isAdmin} />}
        {tab === 'stores' && isAdmin && <Stores m={m} />}
        {tab === 'team' && isAdmin && <Team m={m} userId={userId} />}
      </main>
    </div>
  );
}
