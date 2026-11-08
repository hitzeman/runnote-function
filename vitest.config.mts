import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    // Tests must never reach Strava or OpenAI; both are mocked per-file.
    env: { OPENAI_API_KEY: '', STRAVA_CLIENT_ID: 'test-client', STRAVA_CLIENT_SECRET: 'test-secret' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'text'],
    },
  },
});
