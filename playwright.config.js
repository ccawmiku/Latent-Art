import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    use: {
        baseURL: 'http://127.0.0.1:18088',
    },
    webServer: {
        command:              'python -m http.server 18088',
        url:                  'http://127.0.0.1:18088',
        reuseExistingServer:  true,
        timeout:              10_000,
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
});
