import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { createClient } from '@supabase/supabase-js';
import { IMAGE_TRANSFORMS, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

// Session tokens go to the iOS Keychain / Android Keystore, never to plain storage.
const secureStorage = {
  getItem: async (key: string) => {
    const item = await Keychain.getGenericPassword({ service: key });
    return item ? item.password : null;
  },
  setItem: async (key: string, value: string) => {
    await Keychain.setGenericPassword('session', value, {
      service: key,
      accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  removeItem: async (key: string) => {
    await Keychain.resetGenericPassword({ service: key });
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// Only refresh tokens while the app is in the foreground.
AppState.addEventListener('change', state =>
  state === 'active' ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh(),
);

export function imageUrl(path: string | null, size = 320) {
  if (!path) return undefined;
  const transform = IMAGE_TRANSFORMS ? { transform: { width: size, height: size, resize: 'contain' as const, quality: 70 } } : undefined;
  return supabase.storage.from('product-images').getPublicUrl(path, transform).data.publicUrl;
}
