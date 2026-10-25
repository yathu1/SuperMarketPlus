import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromCents, run, supabase, toCents, useStoresQuery, type Membership } from '../lib';

type StoreProduct = { store_id: string; price_cents: number; stock: number; is_available: boolean };
type Product = {
  id: string;
  name: string;
  unit: string;
  category_id: string | null;
  image_path: string | null;
  is_active: boolean;
  store_products: StoreProduct[];
};
const UNITS = ['each', 'kg', 'g', 'l', 'ml', 'pack'];
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function Products({ m, isAdmin }: { m: Membership; isAdmin: boolean }) {
  const t = m.tenant.id;
  const stores = useQuery(useStoresQuery(t));
  const [storeId, setStoreId] = useState<string>();
  const [search, setSearch] = useState('');
  const store = storeId ?? stores.data?.[0]?.id;

  const categories = useQuery({
    queryKey: ['categories', t],
    queryFn: () => run<{ id: string; name: string }[]>(supabase.from('categories').select('id, name').eq('tenant_id', t).order('sort_order').order('name')),
  });
  const products = useQuery({
    queryKey: ['products', t, store],
    enabled: !!store,
    queryFn: () =>
      run<Product[]>(
        supabase
          .from('products')
          .select('id, name, unit, category_id, image_path, is_active, store_products(store_id, price_cents, stock, is_available)')
          .eq('tenant_id', t)
          .eq('store_products.store_id', store!)
          .order('name'),
      ),
  });
  // ponytail: client-side filter is fine for a few thousand products; move to ilike + paging beyond that.
  const shown = useMemo(
    () => products.data?.filter(p => p.name.toLowerCase().includes(search.toLowerCase())) ?? [],
    [products.data, search],
  );

  return (
    <section>
      <div className="toolbar">
        <h2>Products</h2>
        <select aria-label="Store" value={store} onChange={e => setStoreId(e.target.value)}>
          {stores.data?.map(s => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {isAdmin && store && <NewProduct tenantId={t} storeId={store} categories={categories.data ?? []} />}
      {products.error && <p className="error">{products.error.message}</p>}
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Available</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {store &&
            shown.map(p => (
              <ProductRow key={p.id} p={p} storeId={store} tenantId={t} isAdmin={isAdmin} categoryName={categories.data?.find(c => c.id === p.category_id)?.name} />
            ))}
        </tbody>
      </table>
    </section>
  );
}

function ProductRow({ p, storeId, tenantId, isAdmin, categoryName }: { p: Product; storeId: string; tenantId: string; isAdmin: boolean; categoryName?: string }) {
  const qc = useQueryClient();
  const sp = p.store_products[0];
  const [price, setPrice] = useState(sp ? fromCents(sp.price_cents) : '');
  const [stock, setStock] = useState(String(sp?.stock ?? 0));
  const [available, setAvailable] = useState(sp?.is_available ?? true);
  useEffect(() => {
    setPrice(sp ? fromCents(sp.price_cents) : '');
    setStock(String(sp?.stock ?? 0));
    setAvailable(sp?.is_available ?? true);
  }, [sp]);

  const valid = Number(price) >= 0 && price !== '' && Number.isInteger(Number(stock)) && Number(stock) >= 0;
  const save = useMutation({
    mutationFn: () => {
      const row = { price_cents: toCents(price), stock: Number(stock), is_available: available };
      return sp
        ? run(supabase.from('store_products').update(row).eq('store_id', storeId).eq('product_id', p.id))
        : run(supabase.from('store_products').insert({ ...row, tenant_id: tenantId, store_id: storeId, product_id: p.id }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
  const toggleActive = useMutation({
    mutationFn: () => run(supabase.from('products').update({ is_active: !p.is_active }).eq('id', p.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });

  return (
    <tr className={p.is_active ? '' : 'inactive'}>
      <td>
        {p.name} <span className="muted">/ {p.unit}</span>
        {save.error && <div className="error">{save.error.message}</div>}
      </td>
      <td>{categoryName}</td>
      <td>
        <input aria-label={`${p.name} price`} className="small" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} disabled={!sp && !isAdmin} />
      </td>
      <td>
        <input aria-label={`${p.name} stock`} className="small" inputMode="numeric" value={stock} onChange={e => setStock(e.target.value)} disabled={!sp && !isAdmin} />
      </td>
      <td>
        <input aria-label={`${p.name} available`} type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)} disabled={!sp && !isAdmin} />
      </td>
      <td className="actions">
        {(sp || isAdmin) && (
          <button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {sp ? 'Save' : 'Add to store'}
          </button>
        )}
        {isAdmin && (
          <button className="link" onClick={() => toggleActive.mutate()}>
            {p.is_active ? 'Hide' : 'Show'}
          </button>
        )}
      </td>
    </tr>
  );
}

function NewProduct({ tenantId, storeId, categories }: { tenantId: string; storeId: string; categories: { id: string; name: string }[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  const addCategory = useMutation({
    mutationFn: () => run(supabase.from('categories').insert({ tenant_id: tenantId, name: newCategory.trim() })),
    onSuccess: () => {
      setNewCategory('');
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });

  const create = useMutation({
    mutationFn: async (f: FormData) => {
      const image = f.get('image') as File | null;
      const file = image && image.size > 0 ? image : null;
      const ext = file ? IMAGE_EXT[file.type] : undefined;
      if (file && !ext) throw new Error('Image must be PNG, JPEG or WebP'); // check before any writes
      const product = await run<{ id: string }>(
        supabase
          .from('products')
          .insert({
            tenant_id: tenantId,
            name: String(f.get('name')).trim(),
            category_id: f.get('category') || null,
            unit: f.get('unit'),
            description: String(f.get('description')).trim() || null,
          })
          .select('id')
          .single(),
      );
      await run(
        supabase.from('store_products').insert({
          tenant_id: tenantId,
          store_id: storeId,
          product_id: product.id,
          price_cents: toCents(String(f.get('price'))),
          stock: Number(f.get('stock')),
        }),
      );
      if (file && ext) {
        // Path prefix is the tenant id: storage RLS only lets this tenant's admins write here.
        const path = `${tenantId}/${product.id}-${Date.now()}.${ext}`;
        await run(supabase.storage.from('product-images').upload(path, file, { contentType: file.type }));
        await run(supabase.from('products').update({ image_path: path }).eq('id', product.id));
      }
    },
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  if (!open) return <button onClick={() => setOpen(true)}>+ New product</button>;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    create.mutate(new FormData(e.currentTarget));
  };

  return (
    <form className="card grid" onSubmit={submit}>
      <label>
        Name <input name="name" required maxLength={160} />
      </label>
      <label>
        Category
        <select name="category">
          <option value="">—</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        New category
        <span className="inline">
          <input value={newCategory} onChange={e => setNewCategory(e.target.value)} maxLength={80} />
          <button type="button" disabled={!newCategory.trim()} onClick={() => addCategory.mutate()}>
            Add
          </button>
        </span>
      </label>
      <label>
        Unit
        <select name="unit">
          {UNITS.map(u => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </label>
      <label>
        Price <input name="price" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" />
      </label>
      <label>
        Stock <input name="stock" required inputMode="numeric" pattern="\d+" defaultValue="0" />
      </label>
      <label className="wide">
        Description <textarea name="description" maxLength={2000} />
      </label>
      <label>
        Image <input name="image" type="file" accept="image/png,image/jpeg,image/webp" />
      </label>
      {(create.error || addCategory.error) && <p className="error wide">{(create.error ?? addCategory.error)!.message}</p>}
      <div className="actions wide">
        <button disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Create product'}</button>
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
