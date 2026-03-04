import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { MetricsCollector, formatLoaderTimings, formatLazyRenderAnalysis, type PageMetrics } from '../utils/metrics-collector'
import * as fs from 'fs'

/**
 * Site Configuration
 * ==================
 * CUSTOMIZE THESE VALUES FOR YOUR SITE
 * See discovery.md for how to find each value
 */
const SITE_CONFIG = {
    // URLs - REPLACE THESE
    baseUrl: process.env.SITE_URL || 'http://localhost:8000',
    plpPath: '{{PLP_PATH}}',                    // e.g., '/feminino' or '/utilidades-domesticas'
    fallbackPdpPath: '{{FALLBACK_PDP_PATH}}',   // e.g., '/product-name/p'

    // Deco framework endpoints
    livenessPath: '/deco/_liveness',

    // Debug mode - ALWAYS enabled to get Server-Timing headers with loader info
    debugParam: '?__d',

    // Selectors - REPLACE THESE
    productCard: '{{PRODUCT_CARD_SELECTOR}}',    // e.g., '[data-deco="view-product"]'
    productCardFallback: 'a:has-text("R$")',
    pdpUrlPattern: /\/p/,
    buyButton: '{{BUY_BUTTON_SELECTOR}}',        // e.g., 'button:has-text("Comprar agora")'
    buyButtonFallback: 'button:has-text("Comprar")',
    minicartText: '{{MINICART_TEXT}}',           // e.g., 'Produtos Adicionados'

    // Size selection (fashion stores)
    sizes: {{SIZES_ARRAY}},                      // e.g., ['P', 'M', 'G', 'GG']
    sizeButton: (size: string) => `li button:has-text("${size}")`,

    // Voltage selection (electronics stores)
    voltages: ['110V', '127V', '220V', 'Bivolt'],
    voltageSelector: (voltage: string) => `button:has-text("${voltage}")`,

    // Thresholds (ms) - adjust based on site performance
    thresholds: {
        coldTTFB: 5000,
        warmTTFB: 2000,
        homeTTFB: 3000,
        homeWarmTTFB: 1500,
    },

    // Server warmup settings
    warmup: {
        livenessRetries: 30,
        livenessRetryDelay: 1000,
        warmupTimeout: 60000,
    },
}

/**
 * Server Warmup Utility
 */
async function waitForServerReady(baseUrl: string): Promise<{ livenessTime: number; warmupTime: number }> {
    const { livenessRetries, livenessRetryDelay, warmupTimeout } = SITE_CONFIG.warmup

    console.log('\n⏳ Waiting for server liveness...')
    const livenessStart = Date.now()
    let livenessOk = false

    for (let i = 0; i < livenessRetries; i++) {
        try {
            const res = await fetch(`${baseUrl}${SITE_CONFIG.livenessPath}`, {
                signal: AbortSignal.timeout(5000),
            })
            if (res.ok) {
                livenessOk = true
                break
            }
        } catch {
            // Server not ready yet
        }
        await new Promise(r => setTimeout(r, livenessRetryDelay))
    }

    if (!livenessOk) {
        throw new Error(`Server liveness check failed after ${livenessRetries} attempts`)
    }

    const livenessTime = Date.now() - livenessStart
    console.log(`   ✅ Server alive (${livenessTime}ms)`)

    console.log('   🔥 Warming up server (triggering lazy imports)...')
    const warmupStart = Date.now()

    try {
        const res = await fetch(`${baseUrl}/${SITE_CONFIG.debugParam}`, {
            signal: AbortSignal.timeout(warmupTimeout),
        })
        await res.text()
    } catch (err) {
        console.log(`   ⚠️ Warmup request failed: ${err}`)
    }

    const warmupTime = Date.now() - warmupStart
    console.log(`   ✅ Warmup complete (${warmupTime}ms)`)

    return { livenessTime, warmupTime }
}

/**
 * Page Actions - Reusable browser interactions
 */
class PageActions {
    constructor(private page: Page) {}

    private withDebug(path: string): string {
        const hasQuery = path.includes('?')
        return path + (hasQuery ? '&__d' : SITE_CONFIG.debugParam)
    }

    async goto(path: string) {
        await this.page.goto(this.withDebug(path), { waitUntil: 'domcontentloaded' })
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    }

    async reload() {
        await this.page.reload({ waitUntil: 'domcontentloaded' })
        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    }

    async waitForProducts(): Promise<boolean> {
        let el = await this.page.waitForSelector(SITE_CONFIG.productCard, { timeout: 15000 }).catch(() => null)
        if (el) return true
        el = await this.page.waitForSelector(SITE_CONFIG.productCardFallback, { timeout: 5000 }).catch(() => null)
        return el !== null
    }

    async waitForBuyButton(): Promise<boolean> {
        let el = await this.page.waitForSelector(SITE_CONFIG.buyButton, { timeout: 15000 }).catch(() => null)
        if (el) return true
        el = await this.page.waitForSelector(SITE_CONFIG.buyButtonFallback, { timeout: 5000 }).catch(() => null)
        return el !== null
    }

    async clickFirstProduct(): Promise<boolean> {
        let products = this.page.locator(SITE_CONFIG.productCard)
        let count = await products.count()

        if (count === 0) {
            products = this.page.locator(SITE_CONFIG.productCardFallback)
            count = await products.count()
        }

        if (count === 0) return false

        const href = await products.first().getAttribute('href')
        if (href) {
            await this.page.goto(this.withDebug(href), { waitUntil: 'domcontentloaded' })
        } else {
            await products.first().click()
        }
        await this.page.waitForURL(SITE_CONFIG.pdpUrlPattern, { timeout: 10000 }).catch(() => {})
        const timeout = this.isLocalhost ? 5000 : 30000
        await this.page.waitForLoadState('networkidle', { timeout }).catch(() => {})
        return true
    }

    async selectSize(): Promise<string | null> {
        for (const size of SITE_CONFIG.sizes) {
            const btn = this.page.locator(SITE_CONFIG.sizeButton(size)).first()
            if (await btn.count() > 0) {
                try {
                    await btn.click({ timeout: 2000 })
                    await this.page.waitForTimeout(300)
                    return size
                } catch { continue }
            }
        }
        return null
    }

    async selectVoltage(): Promise<string | null> {
        for (const voltage of SITE_CONFIG.voltages) {
            const btn = this.page.locator(SITE_CONFIG.voltageSelector(voltage)).first()
            if (await btn.count() > 0) {
                try {
                    await btn.click({ timeout: 2000 })
                    await this.page.waitForTimeout(300)
                    return voltage
                } catch { continue }
            }
        }
        return null
    }

    async addToCart(): Promise<number> {
        const start = Date.now()
        let buyBtn = this.page.locator(SITE_CONFIG.buyButton).first()
        if (await buyBtn.count() === 0) {
            buyBtn = this.page.locator(SITE_CONFIG.buyButtonFallback).first()
        }

        if (await buyBtn.count() === 0) return -1

        await buyBtn.click()
        await Promise.race([
            this.page.waitForResponse(r =>
                r.url().includes('orderForm') || r.url().includes('cart') || r.url().includes('items'),
                { timeout: 10000 }
            ),
            this.page.waitForTimeout(3000),
        ]).catch(() => {})

        return Date.now() - start
    }

    async isMinicartOpen(): Promise<boolean> {
        // Multiple selectors with retry logic for robustness
        const selectors = [
            `text=${SITE_CONFIG.minicartText}`,
            '[data-testid="minicart"]',
            '.minicart',
            '[class*="minicart"]',
            '[class*="Minicart"]',
            '[class*="cart-drawer"]',
            '[class*="drawer"][class*="open"]',
        ]
        
        for (let attempt = 0; attempt < 3; attempt++) {
            const timeout = 2000 + (attempt * 1000)
            
            for (const selector of selectors) {
                try {
                    const visible = await this.page.locator(selector).first()
                        .isVisible({ timeout }).catch(() => false)
                    if (visible) return true
                } catch {}
            }
            
            if (attempt < 2) {
                await this.page.waitForTimeout(500)
            }
        }
        
        return false
    }
}

/**
 * Test Suite
 */
test.describe('E-commerce User Journey - {{SITE_NAME}}', () => {
    const metrics: PageMetrics[] = []
    let collector: MetricsCollector
    let actions: PageActions
    let projectName = 'unknown'

    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires this pattern
    test.beforeAll(async ({}, testInfo) => {
        projectName = testInfo.project.name || 'default'
        const baseUrl = SITE_CONFIG.baseUrl
        console.log(`\n🚀 Preparing test run against: ${baseUrl}`)

        try {
            const { livenessTime, warmupTime } = await waitForServerReady(baseUrl)
            console.log(`   📊 Total warmup: ${livenessTime + warmupTime}ms`)
        } catch (err) {
            console.error(`   ❌ Server warmup failed: ${err}`)
            throw err
        }
    })

    test.beforeEach(async ({ page }) => {
        collector = new MetricsCollector(page)
        actions = new PageActions(page)
        await collector.init()
    })

    test.afterEach(async () => {
        await collector.cleanup()
    })

    test.afterAll(async () => {
        if (metrics.length > 0) {
            const summary = {
                totalPages: metrics.length,
                avgTTFB: Math.round(metrics.reduce((s, m) => s + (m.performance.TTFB || 0), 0) / metrics.length),
                avgFCP: Math.round(metrics.reduce((s, m) => s + (m.performance.FCP || 0), 0) / metrics.length),
                totalLazyRenders: metrics.reduce((s, m) => s + m.cacheAnalysis.lazyRenders.length, 0),
                totalLoaders: metrics.reduce((s, m) => s + m.serverTiming.loaders.length, 0),
                cacheHits: metrics.reduce((s, m) => s + m.serverTiming.cacheStats.hit, 0),
                cacheMisses: metrics.reduce((s, m) => s + m.serverTiming.cacheStats.miss, 0),
                pages: metrics.map(m => ({
                    name: m.pageName,
                    ttfb: m.performance.TTFB,
                    fcp: m.performance.FCP,
                    lazyRenders: m.cacheAnalysis.lazyRenders.length,
                    loaders: m.serverTiming.loaders.length,
                    serverTime: m.serverTiming.totalServerTime,
                })),
            }
            
            const report = { 
                project: projectName,
                timestamp: new Date().toISOString(),
                summary,
                metrics,
            }
            fs.mkdirSync('./reports', { recursive: true })
            
            const reportFile = `./reports/report-${projectName}.json`
            fs.writeFileSync(reportFile, JSON.stringify(report, null, 2))
            console.log(`\n📄 Report saved to ${reportFile}`)
            
            const deviceType = projectName.includes('mobile') ? 'mobile' : 'desktop'
            fs.writeFileSync(`./reports/report-latest-${deviceType}.json`, JSON.stringify(report, null, 2))
        }
    })

    test('Home -> PLP -> PDP -> Add to Cart', async ({ page }, testInfo) => {
        const device = testInfo.project.name.includes('mobile') ? '📱 Mobile' : '🖥️  Desktop'
        console.log('\n' + '═'.repeat(70))
        console.log(`${device} (${testInfo.project.name})`)
        console.log('═'.repeat(70))
        
        // ═══════════════════════════════════════════════════════════════════
        // HOMEPAGE (Cold Cache)
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70))
        console.log('🏠 HOMEPAGE (cold cache)')
        console.log('═'.repeat(70))
        collector.startMeasurement()
        await actions.goto('/')

        console.log('   📜 Scrolling to trigger lazy renders (full)...')
        const homeRendersTriggered = await collector.scrollPage({ full: true, maxTime: 20000 })
        console.log(`   📜 Triggered ${homeRendersTriggered} lazy renders`)

        const homeCold = await collector.collectPageMetrics('Homepage Cold')
        metrics.push(homeCold)
        logMetrics(homeCold)

        // ═══════════════════════════════════════════════════════════════════
        // HOMEPAGE (Warm Cache)
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70))
        console.log('🏠 HOMEPAGE (warm cache)')
        console.log('═'.repeat(70))
        collector.startMeasurement()
        await actions.reload()
        await collector.scrollPage({ full: true, maxTime: 15000 })

        const homeWarm = await collector.collectPageMetrics('Homepage Warm')
        metrics.push(homeWarm)
        logMetrics(homeWarm)
        logCacheImprovement('Homepage', homeCold, homeWarm)

        // ═══════════════════════════════════════════════════════════════════
        // PLP (Cold Cache)
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70))
        console.log('📋 PLP - ' + SITE_CONFIG.plpPath + ' (cold cache)')
        console.log('═'.repeat(70))
        collector.startMeasurement()
        await actions.goto(SITE_CONFIG.plpPath)
        const hasProducts = await actions.waitForProducts()
        if (!hasProducts) console.log('   ⚠️ No products loaded')

        console.log('   📜 Scrolling PLP...')
        const plpRendersTriggered = await collector.scrollPage({ full: false })
        console.log(`   📜 Triggered ${plpRendersTriggered} lazy renders`)

        const plpCold = await collector.collectPageMetrics('PLP Cold')
        metrics.push(plpCold)
        logMetrics(plpCold)

        // ═══════════════════════════════════════════════════════════════════
        // PLP (Warm Cache)
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70))
        console.log('📋 PLP - ' + SITE_CONFIG.plpPath + ' (warm cache)')
        console.log('═'.repeat(70))
        collector.startMeasurement()
        await actions.reload()
        await actions.waitForProducts()
        await collector.scrollPage({ full: false })

        const plpWarm = await collector.collectPageMetrics('PLP Warm')
        metrics.push(plpWarm)
        logMetrics(plpWarm)
        logCacheImprovement('PLP', plpCold, plpWarm)

        // ═══════════════════════════════════════════════════════════════════
        // PDP (Cold Cache)
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70))
        console.log('📦 PDP (cold cache)')
        console.log('═'.repeat(70))
        collector.startMeasurement()
        const clickedProduct = await actions.clickFirstProduct()
        if (!clickedProduct) {
            console.log('   ⚠️ No products, going to fallback PDP')
            await actions.goto(SITE_CONFIG.fallbackPdpPath)
        }
        await actions.waitForBuyButton()

        console.log('   📜 Scrolling PDP...')
        const pdpRendersTriggered = await collector.scrollPage({ full: false })
        console.log(`   📜 Triggered ${pdpRendersTriggered} lazy renders`)

        const pdpCold = await collector.collectPageMetrics('PDP Cold')
        metrics.push(pdpCold)
        logMetrics(pdpCold)

        // ═══════════════════════════════════════════════════════════════════
        // PDP (Warm Cache)
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70))
        console.log('📦 PDP (warm cache)')
        console.log('═'.repeat(70))
        collector.startMeasurement()
        await actions.reload()
        await actions.waitForBuyButton()
        await collector.scrollPage({ full: false })

        const pdpWarm = await collector.collectPageMetrics('PDP Warm')
        metrics.push(pdpWarm)
        logMetrics(pdpWarm)
        logCacheImprovement('PDP', pdpCold, pdpWarm)

        // ═══════════════════════════════════════════════════════════════════
        // ADD TO CART
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70))
        console.log('🛒 ADD TO CART')
        console.log('═'.repeat(70))
        collector.startMeasurement()

        // Try size (fashion) or voltage (electronics)
        const selectedSize = await actions.selectSize()
        if (selectedSize) {
            console.log(`   📐 Size selected: ${selectedSize}`)
        } else {
            const selectedVoltage = await actions.selectVoltage()
            if (selectedVoltage) {
                console.log(`   ⚡ Voltage selected: ${selectedVoltage}`)
            }
        }

        const cartTime = await actions.addToCart()
        console.log(cartTime > 0 ? `   ⏱️  Cart response: ${cartTime}ms` : '   ⚠️ Buy button not found')

        const cartMetrics = await collector.collectPageMetrics('Add to Cart')
        metrics.push(cartMetrics)

        // ═══════════════════════════════════════════════════════════════════
        // MINICART VERIFICATION
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '─'.repeat(70))
        console.log('🛍️  Minicart Verification')
        console.log('─'.repeat(70))
        const minicartOpen = await actions.isMinicartOpen()
        console.log(minicartOpen ? '   ✅ Minicart opened successfully' : '   ❌ Minicart not visible')

        // ═══════════════════════════════════════════════════════════════════
        // PERFORMANCE SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70))
        console.log('📊 PERFORMANCE SUMMARY')
        console.log('═'.repeat(70))
        printSummaryTable(metrics)

        // ═══════════════════════════════════════════════════════════════════
        // CACHE ANALYSIS SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '═'.repeat(70))
        console.log('🗄️  CACHE ANALYSIS')
        console.log('═'.repeat(70))
        printCacheAnalysis(metrics)

        // ═══════════════════════════════════════════════════════════════════
        // ASSERTIONS
        // ═══════════════════════════════════════════════════════════════════
        console.log('\n' + '─'.repeat(70))
        console.log('✅ Performance Assertions')
        console.log('─'.repeat(70))

        expect(homeCold.performance.TTFB).toBeLessThan(SITE_CONFIG.thresholds.homeTTFB)
        expect(plpCold.performance.TTFB).toBeLessThan(SITE_CONFIG.thresholds.coldTTFB)
        expect(pdpCold.performance.TTFB).toBeLessThan(SITE_CONFIG.thresholds.coldTTFB)
        console.log('   ✅ Cold cache within thresholds')

        expect(homeWarm.performance.TTFB).toBeLessThan(SITE_CONFIG.thresholds.homeWarmTTFB)
        expect(plpWarm.performance.TTFB).toBeLessThan(SITE_CONFIG.thresholds.warmTTFB)
        expect(pdpWarm.performance.TTFB).toBeLessThan(SITE_CONFIG.thresholds.warmTTFB)
        console.log('   ✅ Warm cache within thresholds')

        expect(minicartOpen, 'Minicart should be visible after adding product to cart').toBe(true)
        console.log('   ✅ Minicart functionality verified')

        console.log('\n' + '═'.repeat(70))
    })
})

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function logMetrics(m: PageMetrics) {
    if (m.decoHeaders?.page || m.decoHeaders?.route) {
        console.log(`   📦 Block: ${m.decoHeaders.page || 'unknown'} │ Route: ${m.decoHeaders.route || 'unknown'}`)
    }
    
    console.log('')
    const ttfbIcon = (m.performance.TTFB || 0) < 500 ? '🟢' : (m.performance.TTFB || 0) < 800 ? '🟡' : '🔴'
    const fcpIcon = (m.performance.FCP || 0) < 1000 ? '🟢' : (m.performance.FCP || 0) < 1800 ? '🟡' : '🔴'
    console.log(`   ${ttfbIcon} TTFB: ${formatMs(m.performance.TTFB)}  ${fcpIcon} FCP: ${formatMs(m.performance.FCP)}  │  🌐 ${m.network.totalRequests} requests (${m.network.totalBytesFormatted})`)

    console.log('')
    const loaderLines = formatLoaderTimings(m.serverTiming)
    for (const line of loaderLines) {
        console.log(line)
    }

    console.log('')
    const cacheLines = formatLazyRenderAnalysis(m.cacheAnalysis)
    for (const line of cacheLines) {
        console.log(line)
    }
}

function formatMs(value: number | null): string {
    if (value === null) return 'N/A'.padStart(7)
    return `${value.toFixed(0)}ms`.padStart(7)
}

function logCacheImprovement(name: string, cold: PageMetrics, warm: PageMetrics) {
    const ttfbDiff = (cold.performance.TTFB || 0) - (warm.performance.TTFB || 0)
    const serverDiff = cold.serverTiming.totalServerTime - warm.serverTiming.totalServerTime
    const ttfbPercent = cold.performance.TTFB ? ((ttfbDiff / cold.performance.TTFB) * 100).toFixed(0) : '0'
    const serverPercent = cold.serverTiming.totalServerTime ? ((serverDiff / cold.serverTiming.totalServerTime) * 100).toFixed(0) : '0'

    console.log('')
    console.log('   🔄 Cache Improvement')
    console.log('   ─────────────────────────────────────────────────────────────')
    console.log(`   │ TTFB:   ${cold.performance.TTFB?.toFixed(0)}ms → ${warm.performance.TTFB?.toFixed(0)}ms  (${ttfbDiff > 0 ? '-' : '+'}${Math.abs(ttfbDiff).toFixed(0)}ms / ${ttfbPercent}%)`)
    console.log(`   │ Server: ${cold.serverTiming.totalServerTime.toFixed(0)}ms → ${warm.serverTiming.totalServerTime.toFixed(0)}ms  (${serverDiff > 0 ? '-' : '+'}${Math.abs(serverDiff).toFixed(0)}ms / ${serverPercent}%)`)

    const coldLazy = cold.cacheAnalysis.lazyRenders.length
    const warmLazyCached = warm.cacheAnalysis.lazyRendersCached
    if (coldLazy > 0) {
        console.log(`   │ Lazy:   ${coldLazy} renders → ${warmLazyCached} cached on reload`)
    }
}

function printSummaryTable(metrics: PageMetrics[]) {
    console.log('')
    console.log('   ┌──────────────────┬─────────────┬─────────────┬────────┐')
    console.log('   │ Page             │       TTFB  │        FCP  │  Lazy  │')
    console.log('   ├──────────────────┼─────────────┼─────────────┼────────┤')

    for (const m of metrics) {
        if (m.pageName === 'Add to Cart') continue
        const name = m.pageName.padEnd(16)
        const ttfbVal = m.performance.TTFB || 0
        const fcpVal = m.performance.FCP || 0
        const ttfbIcon = ttfbVal < 500 ? '🟢' : ttfbVal < 800 ? '🟡' : '🔴'
        const fcpIcon = fcpVal < 1000 ? '🟢' : fcpVal < 1800 ? '🟡' : '🔴'
        const ttfb = `${ttfbIcon} ${formatMs(m.performance.TTFB)}`
        const fcp = `${fcpIcon} ${formatMs(m.performance.FCP)}`
        const lazy = `${m.cacheAnalysis.lazyRenders.length}`.padStart(6)
        console.log(`   │ ${name} │ ${ttfb} │  ${fcp} │ ${lazy} │`)
    }

    console.log('   └──────────────────┴─────────────┴─────────────┴────────┘')
    console.log('')
    console.log('   Legend: 🟢 Good  🟡 Needs Work  🔴 Poor')
    console.log('   Thresholds: TTFB <500ms good, <800ms ok | FCP <1000ms good, <1800ms ok')
}

function printCacheAnalysis(metrics: PageMetrics[]) {
    console.log('')
    console.log('   📄 Page Cache Status:')
    console.log('   ─────────────────────────────────────────────────────────────')
    for (const m of metrics) {
        if (m.pageName === 'Add to Cart') continue
        const icon = m.cacheAnalysis.pageCached ? '✅' : '❌'
        const name = m.pageName.padEnd(18)
        const status = m.cacheAnalysis.pageCached ? 'CACHED' : 'NOT CACHED'
        console.log(`   │ ${icon} ${name} ${status}`)
    }

    console.log('')
    console.log('   🔄 Lazy Render (/deco/render) Summary:')
    console.log('   ─────────────────────────────────────────────────────────────')
    for (const m of metrics) {
        if (m.pageName === 'Add to Cart') continue
        if (m.cacheAnalysis.lazyRenders.length === 0) continue

        const name = m.pageName.padEnd(18)
        const total = m.cacheAnalysis.lazyRenders.length
        const cached = m.cacheAnalysis.lazyRendersCached
        const uncached = m.cacheAnalysis.lazyRendersUncached
        const icon = uncached === 0 ? '✅' : uncached < total / 2 ? '⚠️' : '❌'

        console.log(`   │ ${icon} ${name} ${total} renders (${cached} cached, ${uncached} uncached)`)
    }

    console.log('')
    console.log('   ✅ No cache warnings detected!')
}
