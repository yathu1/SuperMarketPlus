// Shared UI kit. Brand colour comes from the selected food city, so one build serves every tenant.
import { memo, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useShop } from './state/shop';
import type { OrderStatus } from './types';

export const colors = {
  bg: '#F7F7F5',
  card: '#FFFFFF',
  text: '#1A1A1A',
  muted: '#6B6B6B',
  border: '#E4E4E0',
  danger: '#B42318',
  fallbackBrand: '#1B7F3B',
};
export const space = (n: number) => n * 4;

export const useBrand = () => useShop(s => s.tenant?.primary_color ?? colors.fallbackBrand);

export function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

export function Money({ cents, style }: { cents: number; style?: object }) {
  const currency = useShop(s => s.tenant?.currency ?? 'USD');
  return <Text style={[styles.text, style]}>{formatMoney(cents, currency)}</Text>;
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled, style }: ButtonProps) {
  const brand = useBrand();
  const bg = variant === 'primary' ? brand : variant === 'danger' ? colors.danger : 'transparent';
  const fg = variant === 'secondary' ? brand : '#fff';
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === 'secondary' ? brand : bg, opacity: off ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ marginBottom: space(3) }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
        {...props}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export const ErrorText = ({ children }: { children: ReactNode }) => (
  <Text accessibilityRole="alert" style={styles.error}>
    {children}
  </Text>
);

export const Stepper = memo(function Stepper({ qty, max, onChange }: { qty: number; max: number; onChange: (q: number) => void }) {
  const brand = useBrand();
  if (qty === 0) {
    return <Button title="Add" onPress={() => onChange(1)} disabled={max < 1} style={styles.stepperAdd} />;
  }
  return (
    <View style={[styles.stepper, { borderColor: brand }]}>
      <Pressable accessibilityLabel="Decrease quantity" hitSlop={8} onPress={() => onChange(qty - 1)} style={styles.stepBtn}>
        <Text style={[styles.stepText, { color: brand }]}>−</Text>
      </Pressable>
      <Text style={styles.text} accessibilityLabel={`Quantity ${qty}`}>
        {qty}
      </Text>
      <Pressable
        accessibilityLabel="Increase quantity"
        hitSlop={8}
        disabled={qty >= max}
        onPress={() => onChange(qty + 1)}
        style={[styles.stepBtn, qty >= max && { opacity: 0.3 }]}
      >
        <Text style={[styles.stepText, { color: brand }]}>+</Text>
      </Pressable>
    </View>
  );
});

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={[styles.text, { color: colors.muted, textAlign: 'center', marginBottom: space(4) }]}>{title}</Text>
      {children}
    </View>
  );
}

export const Loading = () => (
  <View style={styles.empty}>
    <ActivityIndicator />
  </View>
);

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: 'Received',
  confirmed: 'Confirmed',
  preparing: 'Being packed',
  ready: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function StatusPill({ status }: { status: OrderStatus }) {
  const brand = useBrand();
  const color = status === 'cancelled' ? colors.danger : status === 'completed' ? colors.muted : brand;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: space(4) },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: space(4), borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  text: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  h1: { fontSize: 22, fontWeight: '700', color: colors.text },
  h2: { fontSize: 17, fontWeight: '600', color: colors.text },
  label: { fontSize: 13, color: colors.muted, marginBottom: space(1) },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: space(3),
    paddingVertical: space(3),
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.card,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: space(1) },
  button: { minHeight: 48, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space(4) },
  buttonText: { fontSize: 16, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 10, minHeight: 40 },
  stepperAdd: { minHeight: 40 },
  stepBtn: { paddingHorizontal: space(3), paddingVertical: space(2) },
  stepText: { fontSize: 20, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(8) },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: space(2), paddingVertical: 2, alignSelf: 'flex-start' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space(3) },
});
