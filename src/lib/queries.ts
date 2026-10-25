import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { Address, CatalogItem, Category, Order, Profile, Store, Tenant } from '../types';

// Query keys under 'catalog' are public data and persisted to disk for instant startup;
// everything else is per-user and kept in memory only.
const PAGE = 40;

async function run<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}

export const useTenants = () =>
  useQuery({
    queryKey: ['catalog', 'tenants'],
    queryFn: () => run<Tenant[]>(supabase.from('tenants').select('id, slug, name, primary_color, logo_path, currency').order('name')),
  });

export const useStores = (tenantId: string | undefined) =>
  useQuery({
    queryKey: ['catalog', 'stores', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      run<Store[]>(
        supabase
          .from('stores')
          .select('id, tenant_id, name, address, phone, offers_delivery, delivery_fee_cents, min_order_cents')
          .eq('tenant_id', tenantId!)
          .order('name'),
      ),
  });

export const useCategories = (tenantId: string) =>
  useQuery({
    queryKey: ['catalog', 'categories', tenantId],
    queryFn: () =>
      run<Category[]>(supabase.from('categories').select('id, name').eq('tenant_id', tenantId).order('sort_order').order('name')),
  });

// ponytail: offset paging is fine for grocery-sized catalogues; switch to keyset on (name, product_id) if deep scroll gets slow.
export const useCatalog = (storeId: string, categoryId: string | null, search: string) =>
  useInfiniteQuery({
    queryKey: ['catalog', 'products', storeId, categoryId, search],
    initialPageParam: 0,
    getNextPageParam: (last: CatalogItem[], _all, offset: number) => (last.length === PAGE ? offset + PAGE : undefined),
    queryFn: ({ pageParam }) => {
      let q = supabase
        .from('store_catalog')
        .select('product_id, category_id, name, description, unit, image_path, price_cents, stock')
        .eq('store_id', storeId);
      if (categoryId) q = q.eq('category_id', categoryId);
      if (search) q = q.ilike('name', `%${search.replace(/[%_\\]/g, '\\$&')}%`);
      return run<CatalogItem[]>(q.order('name').order('product_id').range(pageParam, pageParam + PAGE - 1));
    },
  });

// Live price/stock for what's in the cart, so the customer sees changes before checkout.
export const useCartPrices = (storeId: string, productIds: string[]) =>
  useQuery({
    queryKey: ['catalog', 'cart-prices', storeId, [...productIds].sort()],
    enabled: productIds.length > 0,
    staleTime: 0,
    queryFn: () =>
      run<Pick<CatalogItem, 'product_id' | 'price_cents' | 'stock'>[]>(
        supabase.from('store_catalog').select('product_id, price_cents, stock').eq('store_id', storeId).in('product_id', productIds),
      ),
  });

export const useOrders = (enabled: boolean) =>
  useQuery({
    queryKey: ['orders'],
    enabled,
    queryFn: () =>
      run<Order[]>(
        supabase
          .from('orders')
          .select('id, status, fulfilment, subtotal_cents, delivery_fee_cents, total_cents, notes, delivery_address, created_at, store:stores(name, address, phone)')
          .order('created_at', { ascending: false })
          .limit(50),
      ),
  });

export const useOrder = (id: string) =>
  useQuery({
    queryKey: ['orders', id],
    queryFn: () =>
      run<Order>(
        supabase
          .from('orders')
          .select('*, store:stores(name, address, phone), order_items(id, product_name, unit_price_cents, quantity, line_total_cents)')
          .eq('id', id)
          .single(),
      ),
  });

export const useAddresses = (enabled: boolean) =>
  useQuery({
    queryKey: ['addresses'],
    enabled,
    queryFn: () => run<Address[]>(supabase.from('addresses').select('*').order('created_at', { ascending: false })),
  });

export const useProfile = (userId: string | undefined) =>
  useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: () => run<Profile>(supabase.from('profiles').select('id, email, full_name, phone').eq('id', userId!).single()),
  });

export function useSaveProfile(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { full_name: string; phone: string }) => run(supabase.from('profiles').update(p).eq('id', userId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profile'] }),
  });
}

export function useSaveAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Omit<Address, 'id'>) => run<Address>(supabase.from('addresses').insert(a).select().single()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => run(supabase.from('addresses').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
}

export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      storeId: string;
      fulfilment: 'pickup' | 'delivery';
      items: { product_id: string; quantity: number }[];
      addressId: string | null;
      notes: string;
    }) =>
      run<string>(
        supabase.rpc('place_order', {
          p_store_id: args.storeId,
          p_fulfilment: args.fulfilment,
          p_items: args.items,
          p_address_id: args.addressId,
          p_notes: args.notes,
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['catalog', 'products'] }); // stock changed
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => run(supabase.rpc('set_order_status', { p_order_id: orderId, p_status: 'cancelled' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });
}
