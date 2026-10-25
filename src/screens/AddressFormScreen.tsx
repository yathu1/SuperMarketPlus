import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSaveAddress } from '../lib/queries';
import { Button, ErrorText, Field, styles } from '../ui';

const POSTCODE = /^[0-9A-Za-z -]{3,10}$/; // mirrors the DB check

export function AddressFormScreen() {
  const navigation = useNavigation();
  const save = useSaveAddress();
  const [f, setF] = useState({ label: '', line1: '', line2: '', suburb: '', state: '', postcode: '', instructions: '' });
  const set = (k: keyof typeof f) => (v: string) => setF(prev => ({ ...prev, [k]: v }));
  const valid = f.line1.trim() && f.suburb.trim() && f.state.trim() && POSTCODE.test(f.postcode.trim());

  const submit = () => {
    const blankToNull = (v: string) => v.trim() || null;
    save.mutate(
      {
        label: blankToNull(f.label),
        line1: f.line1.trim(),
        line2: blankToNull(f.line2),
        suburb: f.suburb.trim(),
        state: f.state.trim(),
        postcode: f.postcode.trim(),
        instructions: blankToNull(f.instructions),
      },
      { onSuccess: () => navigation.goBack() },
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Field label="Label (e.g. Home)" value={f.label} onChangeText={set('label')} maxLength={40} />
      <Field label="Address line 1" value={f.line1} onChangeText={set('line1')} maxLength={200} autoComplete="address-line1" />
      <Field label="Address line 2" value={f.line2} onChangeText={set('line2')} maxLength={200} autoComplete="address-line2" />
      <Field label="Suburb / town" value={f.suburb} onChangeText={set('suburb')} maxLength={80} />
      <Field label="State / province" value={f.state} onChangeText={set('state')} maxLength={40} />
      <Field label="Postcode" value={f.postcode} onChangeText={set('postcode')} maxLength={10} autoComplete="postal-code" />
      <Field label="Delivery instructions" value={f.instructions} onChangeText={set('instructions')} maxLength={300} multiline />
      {save.error ? <ErrorText>{save.error.message}</ErrorText> : null}
      <Button title="Save address" onPress={submit} disabled={!valid} loading={save.isPending} />
    </ScrollView>
  );
}
