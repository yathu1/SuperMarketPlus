import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  useAddresses,
  useDeleteAddress,
  useProfile,
  useSaveProfile,
} from '../lib/queries';
import { useSession } from '../lib/session';
import { supabase } from '../lib/supabase';
import { useShop } from '../state/shop';
import { Button, ErrorText, Field, Loading, space, styles } from '../ui';

export function AccountScreen() {
  const navigation = useNavigation();
  const session = useSession();
  const tenant = useShop(s => s.tenant);
  const store = useShop(s => s.store);

  if (session === undefined) return <Loading />;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.pad, { gap: space(4) }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.card}>
        <Text style={styles.muted}>Shopping at</Text>
        <Text style={styles.h2}>
          {tenant?.name} · {store?.name}
        </Text>
        <Button
          title="Change store"
          variant="secondary"
          onPress={() => navigation.navigate('SelectStore')}
          style={{ marginTop: space(3) }}
        />
      </View>
      {session ? (
        <SignedIn userId={session.user.id} />
      ) : (
        <Button
          title="Sign in or create account"
          onPress={() => navigation.navigate('Auth')}
        />
      )}
    </ScrollView>
  );
}

function SignedIn({ userId }: { userId: string }) {
  const navigation = useNavigation();
  const profile = useProfile(userId);
  const save = useSaveProfile(userId);
  const addresses = useAddresses(true);
  const remove = useDeleteAddress();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    setFullName(profile.data?.full_name ?? '');
    setPhone(profile.data?.phone ?? '');
  }, [profile.data]);

  return (
    <>
      <View style={styles.card}>
        <Text style={[styles.muted, { marginBottom: space(3) }]}>
          {profile.data?.email}
        </Text>
        <Field
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          maxLength={120}
          autoComplete="name"
        />
        <Field
          label="Phone"
          placeholder="+60 12-345 6789"
          value={phone}
          onChangeText={setPhone}
          maxLength={30}
          keyboardType="phone-pad"
          autoComplete="tel"
        />
        {save.error ? <ErrorText>{save.error.message}</ErrorText> : null}
        <Button
          title={save.isSuccess ? 'Saved' : 'Save details'}
          onPress={() =>
            save.mutate({ full_name: fullName.trim(), phone: phone.trim() })
          }
          loading={save.isPending}
        />
      </View>

      <View style={[styles.card, { gap: space(3) }]}>
        <Text style={styles.h2}>Addresses</Text>
        {addresses.data?.map(a => (
          <View key={a.id} style={styles.row}>
            <Text style={[styles.text, { flex: 1 }]}>
              {[a.label, a.line1, a.suburb].filter(Boolean).join(' · ')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${a.line1}`}
              hitSlop={8}
              onPress={() => remove.mutate(a.id)}
            >
              <Text style={styles.error}>Remove</Text>
            </Pressable>
          </View>
        ))}
        {remove.error ? <ErrorText>{remove.error.message}</ErrorText> : null}
        <Button
          title="Add address"
          variant="secondary"
          onPress={() => navigation.navigate('AddressForm')}
        />
      </View>

      <Button
        title="Sign out"
        variant="danger"
        onPress={() => supabase.auth.signOut()}
      />
    </>
  );
}
