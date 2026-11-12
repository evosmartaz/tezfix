/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo/android',
  setupFiles: ['<rootDir>/test/setup.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup-after-env.ts'],
  testTimeout: 30000,
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-maps|socket.io-client|engine.io-client|@socket.io/.*|standard-navigation|@tezfiks/.*)',
  ],
};
