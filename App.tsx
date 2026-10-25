/**
 * SuperMarketPlus — one app, many food cities.
 *
 * @format
 */

import { useEffect } from 'react';
import { AppState, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, focusManager } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryPersister } from './src/lib/storage';
import { SessionProvider } from './src/lib/session';
import { RootNavigator } from './src/navigation';

const DAY = 24 * 60 * 60 * 1000;
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, gcTime: DAY, retry: 2 } },
});

// Only public catalogue data is written to disk; it renders instantly on next launch
// and refreshes in the background.
const persistOptions = {
  persister: queryPersister,
  maxAge: DAY,
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (q: {
      queryKey: readonly unknown[];
      state: { status: string };
    }) => q.queryKey[0] === 'catalog' && q.state.status === 'success',
  },
};

function App() {
  // Refetch stale data when the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s =>
      focusManager.setFocused(s === 'active'),
    );
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={persistOptions}
      >
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

export default App;
