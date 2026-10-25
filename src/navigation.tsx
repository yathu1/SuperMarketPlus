import { Text } from 'react-native';
import { NavigationContainer, type NavigatorScreenParams } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { cartCount, useShop } from './state/shop';
import { useBrand } from './ui';
import { SelectStoreScreen } from './screens/SelectStoreScreen';
import { ShopScreen } from './screens/ShopScreen';
import { CartScreen } from './screens/CartScreen';
import { CheckoutScreen } from './screens/CheckoutScreen';
import { AuthScreen } from './screens/AuthScreen';
import { OrdersScreen } from './screens/OrdersScreen';
import { OrderDetailScreen } from './screens/OrderDetailScreen';
import { AccountScreen } from './screens/AccountScreen';
import { AddressFormScreen } from './screens/AddressFormScreen';

export type TabParamList = { Shop: undefined; Cart: undefined; Orders: undefined; Account: undefined };
export type RootStackParamList = {
  SelectStore: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  Checkout: undefined;
  Auth: undefined;
  OrderDetail: { id: string };
  AddressForm: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
// ponytail: emoji tab icons; swap for an icon font when design lands.
const icon = (glyph: string) => () => <Text style={{ fontSize: 20 }}>{glyph}</Text>;

function Tabs() {
  const brand = useBrand();
  const count = useShop(cartCount);
  const storeName = useShop(s => s.store?.name);
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: brand }}>
      <Tab.Screen name="Shop" component={ShopScreen} options={{ title: storeName ?? 'Shop', tabBarLabel: 'Shop', tabBarIcon: icon('🛍️') }} />
      <Tab.Screen name="Cart" component={CartScreen} options={{ tabBarBadge: count || undefined, tabBarIcon: icon('🛒') }} />
      <Tab.Screen name="Orders" component={OrdersScreen} options={{ tabBarIcon: icon('🧾') }} />
      <Tab.Screen name="Account" component={AccountScreen} options={{ tabBarIcon: icon('👤') }} />
    </Tab.Navigator>
  );
}

export function RootNavigator() {
  const hasStore = useShop(s => !!s.store);
  return (
    <NavigationContainer>
      <Stack.Navigator>
        {hasStore ? (
          <>
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen name="Checkout" component={CheckoutScreen} />
            <Stack.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: 'Order' }} />
            <Stack.Screen name="AddressForm" component={AddressFormScreen} options={{ title: 'New address' }} />
            <Stack.Screen name="SelectStore" component={SelectStoreScreen} options={{ title: 'Change store' }} />
          </>
        ) : (
          <Stack.Screen name="SelectStore" component={SelectStoreScreen} options={{ title: 'Choose your Food City' }} />
        )}
        <Stack.Screen name="Auth" component={AuthScreen} options={{ presentation: 'modal', title: 'Sign in' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
