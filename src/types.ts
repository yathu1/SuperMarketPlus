// ponytail: hand-written row types; switch to `supabase gen types typescript` once a DB is running in CI.
export type Tenant = {
  id: string;
  slug: string;
  name: string;
  primary_color: string | null;
  logo_path: string | null;
  currency: string;
};

export type Store = {
  id: string;
  tenant_id: string;
  name: string;
  address: string;
  phone: string | null;
  offers_delivery: boolean;
  delivery_fee_cents: number;
  min_order_cents: number;
};

export type Category = { id: string; name: string };

export type CatalogItem = {
  product_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  unit: string;
  image_path: string | null;
  price_cents: number;
  stock: number;
};

export type Address = {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  instructions: string | null;
};

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled';

export type OrderItem = {
  id: string;
  product_name: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
};

export type Order = {
  id: string;
  status: OrderStatus;
  fulfilment: 'pickup' | 'delivery';
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  notes: string | null;
  delivery_address: Omit<Address, 'id'> | null;
  created_at: string;
  store: { name: string; address: string; phone: string | null } | null;
  order_items?: OrderItem[];
};

export type Profile = { id: string; email: string | null; full_name: string | null; phone: string | null };
