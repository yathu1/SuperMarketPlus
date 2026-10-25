import Fastify, { type FastifyRequest } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export type Role = 'owner' | 'admin' | 'staff';
const rank = (r: Role | null | undefined) => (r === 'owner' ? 3 : r === 'admin' ? 2 : r === 'staff' ? 1 : 0);

// Owners appoint admins/staff, admins appoint staff. Nobody manages their peers or seniors,
// and ownership is never granted through the API.
export function canManage(caller: Role | null, target: Role | null, newRole?: Role) {
  if (rank(caller) < 2 || rank(target) >= rank(caller)) return false;
  return newRole === undefined || (newRole !== 'owner' && rank(newRole) < rank(caller));
}

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const tenantParams = z.object({ tenantId: z.uuid() });
const memberParams = tenantParams.extend({ userId: z.uuid() });
const inviteBody = z.object({ email: z.email().max(254).toLowerCase(), role: z.enum(['admin', 'staff']) });

class HttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Member changes send emails and touch auth users: tighter limit, keyed per caller token so
// a spoofed X-Forwarded-For can't dodge it.
const memberRouteLimit = {
  rateLimit: {
    max: 20,
    timeWindow: '1 hour',
    keyGenerator: (req: { headers: { authorization?: string }; ip: string }) => req.headers.authorization ?? req.ip,
  },
};

export function buildApp(opts: {
  supabase: SupabaseClient;
  corsOrigins: string[];
  inviteRedirectUrl?: string;
  trustProxy?: string; // addresses/CIDRs of your reverse proxies; leave unset when exposed directly
  logger?: boolean;
}) {
  const { supabase } = opts;
  const app = Fastify({
    logger: opts.logger === false ? false : { redact: ['req.headers.authorization'] },
    bodyLimit: 16 * 1024,
    trustProxy: opts.trustProxy ?? false,
  });

  app.register(helmet);
  app.register(cors, { origin: opts.corsOrigins, methods: ['GET', 'POST', 'DELETE'] });
  app.register(rateLimit, { max: 60, timeWindow: '1 minute' });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof z.ZodError) return reply.status(400).send({ error: 'Invalid request', issues: err.issues });
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.status(status).send({ error: status >= 500 ? 'Internal error' : err.message });
  });

  async function callerRole(req: FastifyRequest, tenantId: string) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new HttpError(401, 'Missing bearer token');
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, 'Invalid token');
    return { userId: data.user.id, role: await memberRole(tenantId, data.user.id) };
  }

  async function memberRole(tenantId: string, userId: string) {
    const { data, error } = await supabase
      .from('tenant_members').select('role').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return (data?.role ?? null) as Role | null;
  }

  app.get('/health', async () => ({ ok: true }));

  // Routes live in a child plugin so they're added after rate-limit has loaded;
  // otherwise per-route limits are silently ignored.
  app.register(async app => {
    // Existing members are re-roled directly (they already joined). Anyone else gets a pending
    // invite that only takes effect when they accept it with a confirmed email (accept_invite()).
    // The response is identical in every case so admins can't probe which emails have accounts.
    app.post('/v1/tenants/:tenantId/members', { config: memberRouteLimit }, async (req, reply) => {
      const { tenantId } = tenantParams.parse(req.params);
      const { email, role } = inviteBody.parse(req.body);
      const caller = await callerRole(req, tenantId);
      if (!canManage(caller.role, null, role)) throw new HttpError(403, 'Forbidden'); // before any invite email

      const { data: profile, error } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
      if (error) throw error;
      const current = profile ? await memberRole(tenantId, profile.id) : null;
      if (profile && current) {
        if (!canManage(caller.role, current, role)) throw new HttpError(403, 'Forbidden');
        const { error: upsertError } = await supabase
          .from('tenant_members').upsert({ tenant_id: tenantId, user_id: profile.id, role });
        if (upsertError) throw upsertError;
        req.log.info({ tenantId, by: caller.userId, userId: profile.id, role }, 'member re-roled');
        return reply.status(202).send({ ok: true });
      }

      // Don't let an admin overwrite an invite they couldn't have issued (e.g. an owner's admin invite).
      const { data: pending, error: pendingError } = await supabase
        .from('tenant_invites').select('role').eq('tenant_id', tenantId).eq('email', email).maybeSingle();
      if (pendingError) throw pendingError;
      if (pending && !canManage(caller.role, pending.role as Role)) throw new HttpError(403, 'Forbidden');

      const { error: inviteError } = await supabase.from('tenant_invites').upsert({
        tenant_id: tenantId,
        email,
        role,
        invited_by: caller.userId,
        expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      });
      if (inviteError) throw inviteError;
      if (!profile) {
        // No account yet: Supabase emails a sign-up link; the invite waits for them in the admin.
        const signup = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: opts.inviteRedirectUrl });
        if (signup.error) throw signup.error;
      }
      req.log.info({ tenantId, by: caller.userId, role }, 'invite saved');
      return reply.status(202).send({ ok: true });
    });

    app.delete('/v1/tenants/:tenantId/members/:userId', { config: memberRouteLimit }, async (req, reply) => {
      const { tenantId, userId } = memberParams.parse(req.params);
      const caller = await callerRole(req, tenantId);
      const target = await memberRole(tenantId, userId);
      if (!target) throw new HttpError(404, 'Not a member');
      if (!canManage(caller.role, target)) throw new HttpError(403, 'Forbidden');
      const { error } = await supabase.from('tenant_members').delete().eq('tenant_id', tenantId).eq('user_id', userId);
      if (error) throw error;
      req.log.info({ tenantId, by: caller.userId, userId }, 'member removed');
      return reply.status(204).send();
    });
  });

  return app;
}
