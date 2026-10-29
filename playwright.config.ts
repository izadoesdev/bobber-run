// Browser tests (e2e/): the production build, served locally, driven through the window.BR test hooks.
// `bun run e2e` locally; CI runs the same on every push. WebGL runs on SwiftShader, so no GPU is needed.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4870), CI = !!process.env.CI;
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: CI ? 1 : 0,
  workers: CI ? 1 : 4,                      // One CPU-rendered browser per CI runner; high-DPI phone contexts otherwise contend.
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 915, height: 412 } }, grep: /@phone|@both/ },
  ],
  webServer: { command: `bun run build && bunx vite preview --port ${PORT} --strictPort`, port: PORT, reuseExistingServer: !CI, timeout: 120_000 },
});
