import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for E2E Performance Tests
 * 
 * Environment variables:
 *   SITE_URL - Target URL to test (default: localhost tunnel)
 *   HEADED - Set to 'true' for headed mode
 */

const isHeaded = process.env.HEADED === 'true'

export default defineConfig({
    testDir: './specs',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    
    timeout: 120_000,
    expect: { timeout: 10_000 },
    
    reporter: [
        ['list'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'reports/results.json' }],
    ],
    
    use: {
        // REPLACE WITH YOUR SITE URL
        baseURL: process.env.SITE_URL || 'http://localhost:8000',
        
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'on-first-retry',
        viewport: { width: 1280, height: 720 },
        reducedMotion: 'reduce',
        headless: !isHeaded,
    },

    projects: [
        {
            name: 'desktop-chrome',
            use: { 
                ...devices['Desktop Chrome'],
                launchOptions: {
                    args: ['--enable-precise-memory-info'],
                    slowMo: isHeaded ? 100 : 0,
                },
            },
        },
        {
            name: 'mobile-chrome',
            use: { 
                ...devices['Pixel 5'],
                launchOptions: {
                    args: ['--enable-precise-memory-info'],
                    slowMo: isHeaded ? 100 : 0,
                },
            },
        },
    ],

    outputDir: './reports/test-results/',
})
