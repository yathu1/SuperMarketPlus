import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { kvStorage } from '../lib/storage';
import type { Store, Tenant } from '../types';

export type CartLine = {
  productId: string;
  name: string;
  priceCents: number;
  imagePath: string | null;
  qty: number;
};
export const MAX_QTY = 99;

type ShopState = {
  tenant: Tenant | null;
  store: Store | null;
  lines: Record<string, CartLine>;
  selectStore: (tenant: Tenant, store: Store) => void;
  setQty: (item: Omit<CartLine, 'qty'>, qty: number) => void;
  clearCart: () => void;
};

// Chosen food city + store + cart, persisted on device. Prices here are for display only;
// the server re-prices every order in place_order().
export const useShop = create<ShopState>()(
  persist(
    set => ({
      tenant: null,
      store: null,
      lines: {},
      // Prices and stock are per store, so switching store empties the cart.
      selectStore: (tenant, store) =>
        set(s => ({
          tenant,
          store,
          lines: s.store?.id === store.id ? s.lines : {},
        })),
      setQty: (item, qty) =>
        set(s => {
          const lines = { ...s.lines };
          if (qty <= 0) delete lines[item.productId];
          else
            lines[item.productId] = {
              ...item,
              qty: Math.min(Math.floor(qty), MAX_QTY),
            };
          return { lines };
        }),
      clearCart: () => set({ lines: {} }),
    }),
    { name: 'shop', version: 1, storage: createJSONStorage(() => kvStorage) },
  ),
);

export const cartCount = (s: Pick<ShopState, 'lines'>) =>
  Object.values(s.lines).reduce((n, l) => n + l.qty, 0);
