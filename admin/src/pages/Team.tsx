import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, run, supabase, type Membership, type Role } from '../lib';

type Member = { user_id: string; role: Role; created_at: string };
type Profile = { id: string; full_name: string | null; email: string | null };
const RANK: Record<Role, number> = { owner: 3, admin: 2, staff: 1 };

export function Team({ m, userId }: { m: Membership; userId: string }) {
  const qc = useQueryClient();
  const t = m.tenant.id;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'staff' | 'admin'>('staff');

  const members = useQuery({
    queryKey: ['members', t],
    queryFn: async () => {
      const rows = await run<Member[]>(supabase.from('tenant_members').select('user_id, role, created_at').eq('tenant_id', t).order('created_at'));
      const profiles = await run<Profile[]>(supabase.from('profiles').select('id, full_name, email').in('id', rows.map(r => r.user_id)));
      return rows.map(r => ({ ...r, profile: profiles.find(p => p.id === r.user_id) }));
    },
  });

  const invites = useQuery({
    queryKey: ['invites', t],
    queryFn: () =>
      run<{ email: string; role: Role; expires_at: string }[]>(
        supabase.from('tenant_invites').select('email, role, expires_at').eq('tenant_id', t).order('created_at'),
      ),
  });

  const invite = useMutation({
    mutationFn: () => api(`/v1/tenants/${t}/members`, { method: 'POST', body: { email: email.trim(), role } }),
    onSuccess: () => {
      setEmail('');
      qc.invalidateQueries({ queryKey: ['members', t] });
      qc.invalidateQueries({ queryKey: ['invites', t] });
    },
  });
  const revoke = useMutation({
    mutationFn: (inviteEmail: string) => run(supabase.from('tenant_invites').delete().eq('tenant_id', t).eq('email', inviteEmail)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites', t] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/v1/tenants/${t}/members/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', t] }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    invite.mutate();
  };

  return (
    <section>
      <h2>Team</h2>
      <form className="toolbar" onSubmit={submit}>
        <input type="email" required placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email to invite" />
        <select value={role} onChange={e => setRole(e.target.value as typeof role)} aria-label="Role">
          <option value="staff">Staff</option>
          {m.role === 'owner' && <option value="admin">Admin</option>}
        </select>
        <button disabled={invite.isPending}>Invite / update</button>
      </form>
      {invite.isSuccess && (
        <p className="muted">
          Saved. Existing team members are updated now. Anyone else must accept the invite here after signing in with a confirmed email.
        </p>
      )}
      {(invite.error || remove.error || revoke.error || members.error) && (
        <p className="error">{(invite.error ?? remove.error ?? revoke.error ?? members.error)!.message}</p>
      )}
      {!!invites.data?.length && (
        <>
          <h3>Pending invites</h3>
          <table>
            <tbody>
              {invites.data.map(i => (
                <tr key={i.email}>
                  <td>{i.email}</td>
                  <td>{i.role}</td>
                  <td className="muted">
                    {Date.parse(i.expires_at) < Date.now() ? 'Expired' : `Expires ${new Date(i.expires_at).toLocaleDateString()}`}
                  </td>
                  <td className="actions">
                    {(m.role === 'owner' || i.role === 'staff') && (
                      <button className="link danger" disabled={revoke.isPending} onClick={() => revoke.mutate(i.email)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Members</h3>
        </>
      )}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.data?.map(x => (
            <tr key={x.user_id}>
              <td>{x.profile?.full_name}</td>
              <td>{x.profile?.email}</td>
              <td>{x.role}</td>
              <td className="actions">
                {x.user_id !== userId && RANK[x.role] < RANK[m.role] && (
                  <button className="link danger" onClick={() => confirm(`Remove ${x.profile?.email ?? 'this member'}?`) && remove.mutate(x.user_id)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
