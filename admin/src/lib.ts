import { createClient } from '@supabase/supabase-js';

// Read before the client consumes the URL: 'invite' / 'recovery' links land here without a password set.
export const arrivedVia = new URLSearchParams(window.location.hash.slice(1)).get('type');

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export type Role = 'owner' | 'admin' | 'staff';
export type Tenant = { id: string; name: string; currency: string; primary_color: string | null };
export type Membership = { role: Role; tenant: Tenant };
export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
export type Store = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  offers_delivery: boolean;
  delivery_fee_cents: number;
  min_order_cents: number;
  is_active: boolean;
};

export async function run<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}

// Calls the Node API with the signed-in user's JWT; the API re-checks the role server-side.
export async function api(path: string, init: { method: string; body?: object }) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(API_URL + path, {
    method: init.method,
    body: init.body ? JSON.stringify(init.body) : undefined,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token ?? ''}` },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
  return res.status === 204 ? null : res.json();
}

export const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-MY', { style: 'currency', currency }).format(cents / 100); // "RM 12.50"
export const toCents = (v: string) => Math.round(Number(v) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'New',
  confirmed: 'Confirmed',
  preparing: 'Packing',
  ready: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const useStoresQuery = (tenantId: string) => ({
  queryKey: ['stores', tenantId],
  queryFn: () =>
    run<Store[]>(
      supabase
        .from('stores')
        .select('id, name, address, phone, offers_delivery, delivery_fee_cents, min_order_cents, is_active')
        .eq('tenant_id', tenantId)
        .order('name'),
    ),
});
