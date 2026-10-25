/* eslint-env jest */
// MMKV is a native (Nitro) module; use its in-memory mock in tests.
jest.mock('react-native-mmkv', () => {
  const { createMockMMKV } = jest.requireActual(
    'react-native-mmkv/lib/createMMKV/createMockMMKV',
  );
  return { createMMKV: () => createMockMMKV() };
});
