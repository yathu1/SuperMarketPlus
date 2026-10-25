module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/server/',
    '<rootDir>/admin/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/server/', '<rootDir>/admin/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-.*|@react-navigation)/)',
  ],
};
