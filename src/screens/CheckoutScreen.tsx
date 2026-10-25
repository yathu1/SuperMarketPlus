import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { StackActions, useNavigation } from '@react-navigation/native';
import { useAddresses, usePlaceOrder } from '../lib/queries';
import { useSession } from '../lib/session';
import { useShop } from '../state/shop';
import { Button, ErrorText, Field, Money, colors, space, styles, useBrand } from '../ui';
import { useLiveCart } from './CartScreen';

export function CheckoutScreen() {
  const navigation = useNavigation();
  const brand = useBrand();
  const session = useSession();
  const store = useShop(s => s.store)!;
  const clearCart = useShop(s => s.clearCart);
  const { rows, subtotal, hasProblem } = useLiveCart();
  const addresses = useAddresses(!!session);
  const placeOrder = usePlaceOrder();

  const [fulfilment, setFulfilment] = useState<'pickup' | 'delivery'>('pickup');
  const [addressId, setAddressId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!addressId && addresses.data?.length) setAddressId(addresses.data[0].id);
  }, [addresses.data, addressId]);

  const delivery = fulfilment === 'delivery';
  const fee = delivery ? store.delivery_fee_cents : 0;
  const belowMin = delivery && subtotal < store.min_order_cents;
  const canSubmit = rows.length > 0 && !hasProblem && !belowMin && (!delivery || !!addressId);

  const submit = () =>
    placeOrder.mutate(
      {
        storeId: store.id,
        fulfilment,
        addressId: delivery ? addressId : null,
        notes,
        items: rows.map(r => ({ product_id: r.productId, quantity: r.qty })),
      },
      {
        onSuccess: id => {
          clearCart();
          navigation.dispatch(StackActions.replace('OrderDetail', { id }));
        },
      },
    );

  const option = (value: 'pickup' | 'delivery', label: string, enabled = true) => (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: fulfilment === value, disabled: !enabled }}
      disabled={!enabled}
      onPress={() => setFulfilment(value)}
      style={[styles.card, { flex: 1, borderColor: fulfilment === value ? brand : colors.border, opacity: enabled ? 1 : 0.4 }]}
    >
      <Text style={styles.h2}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.pad, { gap: space(4) }]} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', gap: space(3) }}>
        {option('pickup', 'Pickup')}
        {option('delivery', 'Delivery', store.offers_delivery)}
      </View>

      {delivery ? (
        <View style={{ gap: space(2) }}>
          <Text style={styles.h2}>Deliver to</Text>
          {addresses.data?.map(a => (
            <Pressable
              key={a.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: a.id === addressId }}
              onPress={() => setAddressId(a.id)}
              style={[styles.card, { borderColor: a.id === addressId ? brand : colors.border }]}
            >
              <Text style={styles.text}>{a.label || a.line1}</Text>
              <Text style={styles.muted}>
                {[a.line1, a.line2, a.suburb, a.state, a.postcode].filter(Boolean).join(', ')}
              </Text>
            </Pressable>
          ))}
          <Button title="Add address" variant="secondary" onPress={() => navigation.navigate('AddressForm')} />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.h2}>Collect from {store.name}</Text>
          <Text style={styles.muted}>{store.address}</Text>
        </View>
      )}

      <Field label="Notes for the store (optional)" value={notes} onChangeText={setNotes} maxLength={500} multiline />

      <View style={[styles.card, { gap: space(2) }]}>
        <View style={styles.row}>
          <Text style={styles.text}>Subtotal</Text>
          <Money cents={subtotal} />
        </View>
        {delivery ? (
          <View style={styles.row}>
            <Text style={styles.text}>Delivery</Text>
            <Money cents={fee} />
          </View>
        ) : null}
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.h2}>Total</Text>
          <Money cents={subtotal + fee} style={styles.h2} />
        </View>
        <Text style={styles.muted}>Pay by cash or card on {delivery ? 'delivery' : 'pickup'}.</Text>
      </View>

      {belowMin ? (
        <ErrorText>
          Delivery needs a minimum order of <Money cents={store.min_order_cents} style={styles.error} />.
        </ErrorText>
      ) : null}
      {hasProblem ? <ErrorText>Some items changed. Review your cart.</ErrorText> : null}
      {placeOrder.error ? <ErrorText>{placeOrder.error.message}</ErrorText> : null}

      <Button title="Place order" onPress={submit} loading={placeOrder.isPending} disabled={!canSubmit} />
    </ScrollView>
  );
}
