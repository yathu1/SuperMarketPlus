import { type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromCents, run, supabase, toCents, useStoresQuery, type Membership, type Store } from '../lib';

export function Stores({ m }: { m: Membership }) {
  const stores = useQuery(useStoresQuery(m.tenant.id));
  return (
    <section>
      <h2>Stores</h2>
      {stores.error && <p className="error">{stores.error.message}</p>}
      {stores.data?.map(s => <StoreForm key={s.id} tenantId={m.tenant.id} store={s} />)}
      <h3>Add a store</h3>
      <StoreForm tenantId={m.tenant.id} />
    </section>
  );
}

function StoreForm({ tenantId, store }: { tenantId: string; store?: Store }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (f: FormData) => {
      const row = {
        name: String(f.get('name')).trim(),
        address: String(f.get('address')).trim(),
        phone: String(f.get('phone')).trim() || null,
        offers_delivery: f.get('offers_delivery') === 'on',
        delivery_fee_cents: toCents(String(f.get('delivery_fee'))),
        min_order_cents: toCents(String(f.get('min_order'))),
        is_active: f.get('is_active') === 'on',
      };
      return store
        ? run(supabase.from('stores').update(row).eq('id', store.id))
        : run(supabase.from('stores').insert({ ...row, tenant_id: tenantId }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stores'] }),
  });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    save.mutate(new FormData(form), { onSuccess: () => !store && form.reset() });
  };
  const money = { inputMode: 'decimal' as const, pattern: '\\d+(\\.\\d{1,2})?', required: true };

  return (
    <form className="card grid" onSubmit={submit}>
      <label>
        Name <input name="name" required maxLength={120} defaultValue={store?.name} />
      </label>
      <label className="wide">
        Address <input name="address" required defaultValue={store?.address} />
      </label>
      <label>
        Phone <input name="phone" type="tel" defaultValue={store?.phone ?? ''} />
      </label>
      <label>
        Delivery fee <input name="delivery_fee" {...money} defaultValue={fromCents(store?.delivery_fee_cents ?? 0)} />
      </label>
      <label>
        Min. delivery order <input name="min_order" {...money} defaultValue={fromCents(store?.min_order_cents ?? 0)} />
      </label>
      <label className="check">
        <input name="offers_delivery" type="checkbox" defaultChecked={store?.offers_delivery ?? true} /> Offers delivery
      </label>
      <label className="check">
        <input name="is_active" type="checkbox" defaultChecked={store?.is_active ?? true} /> Open for orders
      </label>
      {save.error && <p className="error wide">{save.error.message}</p>}
      <div className="actions wide">
        <button disabled={save.isPending}>{store ? (save.isSuccess ? 'Saved' : 'Save') : 'Add store'}</button>
      </div>
    </form>
  );
}
