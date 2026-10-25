import { Alert, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCancelOrder, useOrder } from '../lib/queries';
import type { RootStackParamList } from '../navigation';
import {
  Button,
  Empty,
  ErrorText,
  Loading,
  Money,
  StatusPill,
  space,
  styles,
} from '../ui';

export function OrderDetailScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, 'OrderDetail'>) {
  const order = useOrder(route.params.id);
  const cancel = useCancelOrder();

  if (order.isPending) return <Loading />;
  if (order.isError) return <Empty title={order.error.message} />;
  const o = order.data;
  const a = o.delivery_address;

  const confirmCancel = () =>
    Alert.alert('Cancel this order?', undefined, [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: () => cancel.mutate(o.id),
      },
    ]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.pad, { gap: space(4) }]}
    >
      <View style={styles.card}>
        <View style={styles.row}>
          <StatusPill status={o.status} />
          <Text style={styles.muted}>#{o.id.slice(0, 8).toUpperCase()}</Text>
        </View>
        <Text style={[styles.h2, { marginTop: space(3) }]}>
          {o.fulfilment === 'delivery'
            ? 'Delivery'
            : `Pickup from ${o.store?.name}`}
        </Text>
        <Text style={styles.muted}>
          {a
            ? [a.line1, a.line2, a.suburb, a.state, a.postcode]
                .filter(Boolean)
                .join(', ')
            : o.store?.address}
        </Text>
        {o.store?.phone ? (
          <Text style={styles.muted}>Store: {o.store.phone}</Text>
        ) : null}
        <Text style={[styles.muted, { marginTop: space(2) }]}>
          {new Date(o.created_at).toLocaleString()}
        </Text>
      </View>

      <View style={[styles.card, { gap: space(2) }]}>
        {o.order_items?.map(i => (
          <View key={i.id} style={styles.row}>
            <Text style={[styles.text, { flex: 1 }]}>
              {i.quantity} × {i.product_name}
            </Text>
            <Money cents={i.line_total_cents} />
          </View>
        ))}
        <View style={styles.divider} />
        <View style={styles.row}>
          <Text style={styles.text}>Subtotal</Text>
          <Money cents={o.subtotal_cents} />
        </View>
        {o.delivery_fee_cents ? (
          <View style={styles.row}>
            <Text style={styles.text}>Delivery</Text>
            <Money cents={o.delivery_fee_cents} />
          </View>
        ) : null}
        <View style={styles.row}>
          <Text style={styles.h2}>Total</Text>
          <Money cents={o.total_cents} style={styles.h2} />
        </View>
        <Text style={styles.muted}>
          Pay on {o.fulfilment === 'delivery' ? 'delivery' : 'pickup'}.
        </Text>
      </View>

      {o.notes ? <Text style={styles.muted}>Notes: {o.notes}</Text> : null}
      {cancel.error ? <ErrorText>{cancel.error.message}</ErrorText> : null}
      {o.status === 'pending' ? (
        <Button
          title="Cancel order"
          variant="danger"
          onPress={confirmCancel}
          loading={cancel.isPending}
        />
      ) : null}
    </ScrollView>
  );
}
