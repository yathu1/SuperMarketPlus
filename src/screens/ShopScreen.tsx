import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useCatalog, useCategories } from '../lib/queries';
import { imageUrl } from '../lib/supabase';
import { MAX_QTY, useShop } from '../state/shop';
import { Button, Empty, Loading, Money, Stepper, colors, space, styles, useBrand } from '../ui';
import type { CatalogItem } from '../types';

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ShopScreen() {
  const tenant = useShop(s => s.tenant)!;
  const store = useShop(s => s.store)!;
  const brand = useBrand();
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const query = useDebounced(search.trim());
  const categories = useCategories(tenant.id);
  const catalog = useCatalog(store.id, category, query);
  const items = useMemo(() => catalog.data?.pages.flat() ?? [], [catalog.data]);
  const chips = useMemo(() => [{ id: null, name: 'All' }, ...(categories.data ?? [])], [categories.data]);

  const renderItem = useCallback(({ item }: { item: CatalogItem }) => <ProductCard item={item} />, []);
  const onEndReached = () => {
    if (catalog.hasNextPage && !catalog.isFetchingNextPage) catalog.fetchNextPage();
  };

  return (
    <View style={styles.screen}>
      <View style={{ paddingHorizontal: space(4), paddingTop: space(3) }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search products"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Search products"
          returnKeyType="search"
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={chips}
        keyExtractor={c => c.id ?? 'all'}
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ padding: space(3), gap: space(2) }}
        renderItem={({ item }) => {
          const active = item.id === category;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setCategory(item.id)}
              style={[styles.pill, { paddingHorizontal: space(3), paddingVertical: space(1.5), borderColor: brand, backgroundColor: active ? brand : 'transparent' }]}
            >
              <Text style={{ color: active ? '#fff' : brand, fontWeight: '600' }}>{item.name}</Text>
            </Pressable>
          );
        }}
      />
      {catalog.isPending ? (
        <Loading />
      ) : catalog.isError && items.length === 0 ? (
        <Empty title="Couldn't load products.">
          <Button title="Retry" onPress={() => catalog.refetch()} />
        </Empty>
      ) : (
        <FlashList
          data={items}
          numColumns={2}
          keyExtractor={i => i.product_id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: space(2), paddingBottom: space(6) }}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          refreshing={catalog.isRefetching && !catalog.isFetchingNextPage}
          onRefresh={() => catalog.refetch()}
          ListEmptyComponent={<Empty title={query ? `No products match “${query}”.` : 'No products here yet.'} />}
          ListFooterComponent={catalog.isFetchingNextPage ? <Loading /> : null}
        />
      )}
    </View>
  );
}

// Each card subscribes only to its own cart line, so changing one quantity re-renders one card.
const ProductCard = memo(function ProductCard({ item }: { item: CatalogItem }) {
  const qty = useShop(s => s.lines[item.product_id]?.qty ?? 0);
  const setQty = useShop(s => s.setQty);
  const uri = imageUrl(item.image_path);
  const max = Math.min(item.stock, MAX_QTY);
  const onChange = useCallback(
    (q: number) => setQty({ productId: item.product_id, name: item.name, priceCents: item.price_cents, imagePath: item.image_path }, q),
    [item, setQty],
  );

  return (
    <View style={[styles.card, { margin: space(1.5), padding: space(3), flex: 1 }]}>
      <View style={{ aspectRatio: 1, borderRadius: 8, backgroundColor: colors.bg, marginBottom: space(2), overflow: 'hidden' }}>
        {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" accessibilityIgnoresInvertColors /> : null}
      </View>
      <Text style={styles.text} numberOfLines={2}>
        {item.name}
      </Text>
      <View style={[styles.row, { marginVertical: space(2) }]}>
        <Money cents={item.price_cents} style={{ fontWeight: '700' }} />
        <Text style={styles.muted}>/ {item.unit}</Text>
      </View>
      {item.stock > 0 ? <Stepper qty={qty} max={max} onChange={onChange} /> : <Text style={[styles.muted, { textAlign: 'center', paddingVertical: space(2) }]}>Out of stock</Text>}
    </View>
  );
});
