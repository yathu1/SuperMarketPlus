import { cartCount, useShop, MAX_QTY } from '../src/state/shop';
import { formatMoney } from '../src/ui';
import type { Store, Tenant } from '../src/types';

const tenant = { id: 't1', name: 'T', currency: 'LKR' } as Tenant;
const storeA = { id: 'a' } as Store;
const storeB = { id: 'b' } as Store;
const milk = { productId: 'p1', name: 'Milk', priceCents: 380, imagePath: null };

beforeEach(() => useShop.setState({ tenant: null, store: null, lines: {} }));

test('quantities are clamped and zero removes the line', () => {
  const { setQty } = useShop.getState();
  setQty(milk, 2.7);
  expect(useShop.getState().lines.p1.qty).toBe(2);
  setQty(milk, 500);
  expect(useShop.getState().lines.p1.qty).toBe(MAX_QTY);
  setQty(milk, 0);
  expect(useShop.getState().lines).toEqual({});
});

test('cart count sums quantities', () => {
  const { setQty } = useShop.getState();
  setQty(milk, 2);
  setQty({ ...milk, productId: 'p2' }, 3);
  expect(cartCount(useShop.getState())).toBe(5);
});

test('switching store clears the cart, reselecting the same store keeps it', () => {
  const { selectStore, setQty } = useShop.getState();
  selectStore(tenant, storeA);
  setQty(milk, 1);
  selectStore(tenant, storeA);
  expect(cartCount(useShop.getState())).toBe(1);
  selectStore(tenant, storeB);
  expect(useShop.getState().lines).toEqual({});
});

test('money is formatted in the tenant currency', () => {
  expect(formatMoney(12345, 'AUD')).toContain('123.45');
});
