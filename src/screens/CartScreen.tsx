import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useCartPrices } from '../lib/queries';
import { useSession } from '../lib/session';
import { MAX_QTY, useShop } from '../state/shop';
import {
  Button,
  Empty,
  ErrorText,
  Money,
  Stepper,
  colors,
  space,
  styles,
} from '../ui';

const Divider = () => <View style={styles.divider} />;

// Merges the persisted cart with live price/stock from the server.
export function useLiveCart() {
  const store = useShop(s => s.store)!;
  const lines = useShop(s => s.lines);
  const ids = useMemo(() => Object.keys(lines), [lines]);
  const live = useCartPrices(store.id, ids);

  return useMemo(() => {
    const byId = new Map(live.data?.map(r => [r.product_id, r]));
    const rows = Object.values(lines).map(line => {
      const l = byId.get(line.productId);
      return {
        ...line,
        priceCents: l?.price_cents ?? line.priceCents,
        stock: l?.stock ?? MAX_QTY,
        unavailable: !!live.data && (!l || l.stock < line.qty),
      };
    });
    const subtotal = rows.reduce((n, r) => n + r.priceCents * r.qty, 0);
    return {
      rows,
      subtotal,
      checking: live.isFetching,
      hasProblem: rows.some(r => r.unavailable),
      error: live.error,
    };
  }, [lines, live.data, live.isFetching, live.error]);
}

export function CartScreen() {
  const navigation = useNavigation();
  const session = useSession();
  const setQty = useShop(s => s.setQty);
  const { rows, subtotal, checking, hasProblem, error } = useLiveCart();

  if (rows.length === 0) {
    return (
      <Empty title="Your cart is empty.">
        <Button
          title="Start shopping"
          onPress={() => navigation.navigate('Tabs', { screen: 'Shop' })}
        />
      </Empty>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={r => r.productId}
        contentContainerStyle={styles.pad}
        ItemSeparatorComponent={Divider}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: space(3) }}>
              <Text style={styles.text}>{item.name}</Text>
              <Money cents={item.priceCents} style={styles.muted} />
              {item.unavailable ? (
                <ErrorText>
                  {item.stock > 0
                    ? `Only ${item.stock} left`
                    : 'No longer available'}
                </ErrorText>
              ) : null}
            </View>
            <View style={{ width: 120 }}>
              <Stepper
                qty={item.qty}
                max={Math.min(item.stock, MAX_QTY)}
                onChange={q => setQty(item, q)}
              />
            </View>
          </View>
        )}
      />
      <View
        style={[
          styles.pad,
          {
            borderTopWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          },
        ]}
      >
        <View style={[styles.row, { marginBottom: space(3) }]}>
          <Text style={styles.h2}>Subtotal</Text>
          <Money cents={subtotal} style={styles.h2} />
        </View>
        {error ? (
          <ErrorText>
            Couldn't check latest prices. Totals are confirmed at checkout.
          </ErrorText>
        ) : null}
        <Button
          title={session ? 'Checkout' : 'Sign in to checkout'}
          disabled={hasProblem || checking}
          onPress={() => navigation.navigate(session ? 'Checkout' : 'Auth')}
        />
      </View>
    </View>
  );
}
