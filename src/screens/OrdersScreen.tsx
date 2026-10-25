import { FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useOrders } from '../lib/queries';
import { useSession } from '../lib/session';
import {
  Button,
  Empty,
  Loading,
  Money,
  StatusPill,
  space,
  styles,
} from '../ui';

const Gap = () => <View style={{ height: space(3) }} />;

export function OrdersScreen() {
  const navigation = useNavigation();
  const session = useSession();
  const orders = useOrders(!!session);

  if (session === undefined) return <Loading />;
  if (!session) {
    return (
      <Empty title="Sign in to see your orders.">
        <Button title="Sign in" onPress={() => navigation.navigate('Auth')} />
      </Empty>
    );
  }
  if (orders.isPending) return <Loading />;

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.pad}
      data={orders.data ?? []}
      keyExtractor={o => o.id}
      refreshing={orders.isRefetching}
      onRefresh={() => orders.refetch()}
      ItemSeparatorComponent={Gap}
      ListEmptyComponent={
        <Empty
          title={orders.isError ? orders.error.message : 'No orders yet.'}
        />
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          style={styles.card}
          onPress={() => navigation.navigate('OrderDetail', { id: item.id })}
        >
          <View style={styles.row}>
            <StatusPill status={item.status} />
            <Money cents={item.total_cents} style={{ fontWeight: '700' }} />
          </View>
          <Text style={[styles.text, { marginTop: space(2) }]}>
            {item.store?.name} ·{' '}
            {item.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}
          </Text>
          <Text style={styles.muted}>
            {new Date(item.created_at).toLocaleString()}
          </Text>
        </Pressable>
      )}
    />
  );
}
