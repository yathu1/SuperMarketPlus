import { createMMKV } from 'react-native-mmkv';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

// Fast synchronous KV for non-sensitive data only (catalogue cache, cart, chosen store).
// Auth tokens live in the Keychain/Keystore — see lib/supabase.ts.
export const mmkv = createMMKV({ id: 'app' });

export const kvStorage = {
  getItem: (key: string) => mmkv.getString(key) ?? null,
  setItem: (key: string, value: string) => mmkv.set(key, value),
  removeItem: (key: string) => {
    mmkv.remove(key);
  },
};

export const queryPersister = createSyncStoragePersister({
  storage: kvStorage,
  key: 'query-cache',
});
