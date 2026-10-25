import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { buildApp } from './app.ts';

const env = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  INVITE_REDIRECT_URL: z.url().optional(),
  TRUST_PROXY: z.string().optional(), // e.g. "loopback" or "10.0.0.0/8"; unset = trust no proxy headers
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
}).parse(process.env);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = buildApp({
  supabase,
  corsOrigins: env.CORS_ORIGINS.split(',').map(s => s.trim()),
  inviteRedirectUrl: env.INVITE_REDIRECT_URL,
  trustProxy: env.TRUST_PROXY,
});

for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => void app.close());
await app.listen({ port: env.PORT, host: env.HOST });
