import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { STATUS_LABEL, money, run, supabase, type Membership, type OrderStatus } from '../lib';

type OrderRow = {
  id: string;
  status: OrderStatus;
  fulfilment: 'pickup' | 'delivery';
  total_cents: number;
  created_at: string;
  store: { name: string } | null;
};
type OrderDetail = OrderRow & {
  user_id: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  notes: string | null;
  delivery_address: Record<string, string | null> | null;
  order_items: { id: string; product_name: string; quantity: number; unit_price_cents: number; line_total_cents: number }[];
};

// Mirrors set_order_status() in the database, which is the real authority.
const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'out_for_delivery', 'cancelled'],
  ready: ['completed'],
  out_for_delivery: ['completed'],
  completed: [],
  cancelled: [],
};

export function Orders({ m }: { m: Membership }) {
  const [filter, setFilter] = useState<'open' | OrderStatus>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const orders = useQuery({
    queryKey: ['orders', m.tenant.id, filter],
    refetchInterval: 15_000, // ponytail: polling; switch to Supabase Realtime when order volume warrants it
    queryFn: () => {
      let q = supabase
        .from('orders')
        .select('id, status, fulfilment, total_cents, created_at, store:stores(name)')
        .eq('tenant_id', m.tenant.id)
        .order('created_at', { ascending: filter === 'open' })
        .limit(200);
      q = filter === 'open' ? q.not('status', 'in', '(completed,cancelled)') : q.eq('status', filter);
      return run<OrderRow[]>(q);
    },
  });

  return (
    <div className="split">
      <section>
        <div className="toolbar">
          <h2>Orders</h2>
          <select aria-label="Filter orders" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
            <option value="open">Open</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {orders.error && <p className="error">{orders.error.message}</p>}
        <table>
          <thead>
            <tr>
              <th>Placed</th>
              <th>Store</th>
              <th>Type</th>
              <th>Status</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.data?.map(o => (
              <tr key={o.id} className={o.id === selected ? 'selected' : ''} onClick={() => setSelected(o.id)}>
                <td>{new Date(o.created_at).toLocaleString()}</td>
                <td>{o.store?.name}</td>
                <td>{o.fulfilment}</td>
                <td>
                  <span className={`pill ${o.status}`}>{STATUS_LABEL[o.status]}</span>
                </td>
                <td className="num">{money(o.total_cents, m.tenant.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.data?.length === 0 && <p className="muted">No orders.</p>}
      </section>
      {selected && <OrderPanel id={selected} m={m} />}
    </div>
  );
}

function OrderPanel({ id, m }: { id: string; m: Membership }) {
  const qc = useQueryClient();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () =>
      run<OrderDetail>(
        supabase
          .from('orders')
          .select('*, store:stores(name), order_items(id, product_name, quantity, unit_price_cents, line_total_cents)')
          .eq('id', id)
          .single(),
      ),
  });
  const customer = useQuery({
    queryKey: ['profile', order.data?.user_id],
    enabled: !!order.data,
    queryFn: () =>
      run<{ full_name: string | null; email: string | null; phone: string | null } | null>(
        supabase.from('profiles').select('full_name, email, phone').eq('id', order.data!.user_id).maybeSingle(),
      ),
  });
  const advance = useMutation({
    mutationFn: (status: OrderStatus) => run(supabase.rpc('set_order_status', { p_order_id: id, p_status: status })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', id] });
    },
  });

  if (!order.data) return <aside className="card">{order.error?.message ?? 'Loading…'}</aside>;
  const o = order.data;
  const fmt = (c: number) => money(c, m.tenant.currency);
  const next = NEXT[o.status].filter(
    s => !(s === 'ready' && o.fulfilment !== 'pickup') && !(s === 'out_for_delivery' && o.fulfilment !== 'delivery'),
  );
  const a = o.delivery_address;

  return (
    <aside className="card">
      <h3>
        #{o.id.slice(0, 8).toUpperCase()} <span className={`pill ${o.status}`}>{STATUS_LABEL[o.status]}</span>
      </h3>
      <p className="muted">
        {o.store?.name} · {o.fulfilment} · {new Date(o.created_at).toLocaleString()}
      </p>
      <p>
        <strong>{customer.data?.full_name || 'Customer'}</strong>
        <br />
        {customer.data?.phone} {customer.data?.email}
      </p>
      {a && <p>{[a.line1, a.line2, a.suburb, a.state, a.postcode].filter(Boolean).join(', ')}{a.instructions ? ` — ${a.instructions}` : ''}</p>}
      {o.notes && <p className="note">Note: {o.notes}</p>}
      <table>
        <tbody>
          {o.order_items.map(i => (
            <tr key={i.id}>
              <td>{i.quantity} ×</td>
              <td>{i.product_name}</td>
              <td className="num">{fmt(i.line_total_cents)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2}>Subtotal</td>
            <td className="num">{fmt(o.subtotal_cents)}</td>
          </tr>
          {o.delivery_fee_cents > 0 && (
            <tr>
              <td colSpan={2}>Delivery</td>
              <td className="num">{fmt(o.delivery_fee_cents)}</td>
            </tr>
          )}
          <tr>
            <th colSpan={2}>Total (collect on {o.fulfilment})</th>
            <th className="num">{fmt(o.total_cents)}</th>
          </tr>
        </tbody>
      </table>
      {advance.error && <p className="error">{advance.error.message}</p>}
      <div className="actions">
        {next.map(s => (
          <button
            key={s}
            className={s === 'cancelled' ? 'danger' : ''}
            disabled={advance.isPending}
            onClick={() => (s !== 'cancelled' || confirm('Cancel this order and restock its items?')) && advance.mutate(s)}
          >
            {s === 'cancelled' ? 'Cancel order' : `Mark ${STATUS_LABEL[s].toLowerCase()}`}
          </button>
        ))}
      </div>
    </aside>
  );
}
