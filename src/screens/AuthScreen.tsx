import { useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Button, ErrorText, Field, space, styles } from '../ui';

export function AuthScreen() {
  const navigation = useNavigation();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const creds = { email: email.trim(), password };
    const { data, error: err } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword(creds)
        : await supabase.auth.signUp({
            ...creds,
            options: { data: { full_name: fullName.trim() } },
          });
    setBusy(false);
    if (err) return setError(err.message);
    if (!data.session)
      return setNotice(
        'Check your email to confirm your account, then sign in.',
      );
    navigation.goBack();
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.pad}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.h1, { marginBottom: space(4) }]}>
        {mode === 'signin' ? 'Welcome back' : 'Create account'}
      </Text>
      {mode === 'signup' ? (
        <Field
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          autoComplete="name"
          maxLength={120}
        />
      ) : null}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        textContentType={mode === 'signin' ? 'password' : 'newPassword'}
      />
      {mode === 'signup' ? (
        <Text style={[styles.muted, { marginBottom: space(3) }]}>
          At least 10 characters, with letters and numbers.
        </Text>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {notice ? (
        <Text style={[styles.text, { marginVertical: space(2) }]}>
          {notice}
        </Text>
      ) : null}
      <Button
        title={mode === 'signin' ? 'Sign in' : 'Create account'}
        onPress={submit}
        loading={busy}
        disabled={!email || !password}
        style={{ marginTop: space(2) }}
      />
      <Pressable
        onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        style={{ marginTop: space(4) }}
        hitSlop={8}
      >
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          {mode === 'signin'
            ? 'New here? Create an account'
            : 'Already have an account? Sign in'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
