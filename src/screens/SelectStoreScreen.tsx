import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStores, useTenants } from '../lib/queries';
import { useShop } from '../state/shop';
import {
  Button,
  Empty,
  ErrorText,
  Loading,
  formatMoney,
  space,
  styles,
} from '../ui';
import type { Tenant } from '../types';

const Gap = () => <View style={{ height: space(3) }} />;

export function SelectStoreScreen() {
  const navigation = useNavigation();
  const selectStore = useShop(s => s.selectStore);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const tenants = useTenants();
  const stores = useStores(tenant?.id);

  if (!tenant) {
    if (tenants.isPending) return <Loading />;
    if (tenants.isError) {
      return (
        <Empty title={tenants.error.message}>
          <Button title="Retry" onPress={() => tenants.refetch()} />
        </Empty>
      );
    }
    return (
      <FlatList
        style={styles.screen}
        contentContainerStyle={styles.pad}
        data={tenants.data}
        keyExtractor={t => t.id}
        ItemSeparatorComponent={Gap}
        ListEmptyComponent={<Empty title="No food cities available yet." />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => setTenant(item)}
            style={styles.card}
          >
            <View
              style={[
                styles.row,
                { justifyContent: 'flex-start', gap: space(3) },
              ]}
            >
              <View
                style={{
                  width: 12,
                  height: 40,
                  borderRadius: 6,
                  backgroundColor: item.primary_color ?? '#999',
                }}
              />
              <Text style={styles.h2}>{item.name}</Text>
            </View>
          </Pressable>
        )}
      />
    );
  }

  return (
    <FlatList
      style={styles.screen}
      contentContainerStyle={styles.pad}
      data={stores.data ?? []}
      keyExtractor={s => s.id}
      ItemSeparatorComponent={Gap}
      ListHeaderComponent={
        <View style={{ marginBottom: space(4) }}>
          <Text style={styles.h1}>{tenant.name}</Text>
          <Pressable onPress={() => setTenant(null)} hitSlop={8}>
            <Text style={[styles.muted, { marginTop: space(1) }]}>
              ← Choose a different food city
            </Text>
          </Pressable>
          {stores.isError ? (
            <ErrorText>{stores.error.message}</ErrorText>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        stores.isPending ? (
          <Loading />
        ) : (
          <Empty title="No stores open in this food city." />
        )
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          style={styles.card}
          onPress={() => {
            selectStore(tenant, item);
            if (navigation.canGoBack()) navigation.goBack();
          }}
        >
          <Text style={styles.h2}>{item.name}</Text>
          <Text style={styles.muted}>{item.address}</Text>
          <Text style={[styles.muted, { marginTop: space(2) }]}>
            {item.offers_delivery
              ? `Pickup · Delivery ${formatMoney(
                  item.delivery_fee_cents,
                  tenant.currency,
                )}`
              : 'Pickup only'}
          </Text>
        </Pressable>
      )}
    />
  );
}
