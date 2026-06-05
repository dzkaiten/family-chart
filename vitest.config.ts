import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Unit tests cover the app's pure logic (adapters, mapping). They run in the
// node environment; nothing here needs a DOM. The @lib alias mirrors
// app/vite.config.ts so test imports resolve the same way the app does.
//
// `define` stubs the Vite env vars so modules that construct the Supabase
// client at import time (db.ts) don't throw on an undefined URL. No network
// happens at construction, so a syntactically valid URL is enough.
export default defineConfig({
  resolve: {
    alias: {
      '@lib': resolve(__dirname, 'src')
    }
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://localhost:54321'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
    'import.meta.env.VITE_TREE_ID': JSON.stringify('00000000-0000-0000-0000-000000000000')
  },
  test: {
    environment: 'node',
    include: ['app/src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    globals: false
  }
});
