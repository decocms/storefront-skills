import type { Page, CDPSession, Response, Request } from '@playwright/test'

export interface PerformanceMetrics {
    LCP: number | null
    FCP: number | null
    CLS: number | null
    TTFB: number | null
    domContentLoaded: number | null
}

export interface NetworkMetrics {
    totalRequests: number
    totalBytes: number
    totalBytesFormatted: string
    slowestRequests: Array<{ url: string; duration: number; type: string }>
    failedRequests: number
}

/**
 * Individual loader timing from Server-Timing header
 */
export interface LoaderTiming {
    name: string
    duration: number
    status: string | null  // 'bypass', 'HIT', 'MISS', 'STALE', etc.
}

/**
 * Server-side timing metrics from Deco's ?__d debug mode
 */
export interface ServerTimingMetrics {
    loaders: LoaderTiming[]
    totalServerTime: number
    slowestLoaders: LoaderTiming[]
    cacheStats: {
        total: number
        bypass: number
        hit: number
        miss: number
        stale: number
    }
}

/**
 * Lazy render request tracking (/deco/render)
 */
export interface LazyRenderRequest {
    url: string
    sectionName: string
    duration: number
    cached: boolean
    cacheStatus: string | null  // 'HIT' | 'MISS' | 'STALE' | 'DYNAMIC' | null
    cacheControl: string | null
    serverTiming: LoaderTiming[]
    status: number
}

/**
 * Page cache analysis
 */
export interface CacheAnalysis {
    pageUrl: string
    pageCached: boolean
    pageCacheControl: string | null
    lazyRenders: LazyRenderRequest[]
    lazyRendersCached: number
    lazyRendersUncached: number
    serverSideLoaders: LoaderTiming[]
    warnings: string[]
}

export interface PageMetrics {
    url: string
    pageName: string
    timestamp: string
    performance: PerformanceMetrics
    network: NetworkMetrics
    serverTiming: ServerTimingMetrics
    cacheAnalysis: CacheAnalysis
    renderTime: number
    errors: string[]
    /** Deco observability headers */
    decoHeaders: {
        page: string | null      // x-deco-page - matched page block name
        route: string | null     // x-deco-route - matched route template
        platform: string | null  // x-deco-platform
    }
}

interface NetworkEntry {
    url: string
    type: string
    startTime: number
    endTime?: number
    size: number
    status?: number
}

/**
 * Metrics collector for Deco e2e tests with Server-Timing and lazy render tracking
 * Captures browser Web Vitals, server-side loader timings, and /deco/render patterns
 */
export class MetricsCollector {
    private page: Page
    private cdp: CDPSession | null = null
    private requests = new Map<string, NetworkEntry>()
    private requestIdCounter = 0
    private requestToId = new WeakMap<Request, string>()
    private errors: string[] = []
    private startTime = 0
    private serverTimingHeader: string | null = null
    private pageCacheControl: string | null = null
    private lazyRenders: LazyRenderRequest[] = []
    private pendingLazyRenders = 0 // Track in-flight /deco/render requests
    // Deco observability headers
    private decoPageHeader: string | null = null
    private decoRouteHeader: string | null = null
    private decoPlatformHeader: string | null = null

    constructor(page: Page) {
        this.page = page
    }

    async init(): Promise<void> {
        // CDP for performance metrics
        this.cdp = await this.page.context().newCDPSession(this.page)
        await this.cdp.send('Performance.enable')

        // Track network
        this.page.on('request', (req: Request) => {
            const id = `req-${++this.requestIdCounter}`
            this.requestToId.set(req, id)
            this.requests.set(id, {
                url: req.url(),
                type: req.resourceType(),
                startTime: Date.now(),
                size: 0,
            })
            // Track pending lazy render requests
            if (req.url().includes('/deco/render')) {
                this.pendingLazyRenders++
            }
        })

        this.page.on('response', async (res: Response) => {
            const req = res.request()
            const url = req.url()
            const id = this.requestToId.get(req)
            if (id) {
                const entry = this.requests.get(id)!
                entry.endTime = Date.now()
                entry.status = res.status()
                try {
                    const contentLength = res.headers()['content-length']
                    if (contentLength) {
                        entry.size = parseInt(contentLength, 10)
                    } else if (req.resourceType() === 'document' || url.includes('/deco/render')) {
                        const body = await res.body().catch(() => null)
                        entry.size = body?.length || 0
                    }
                } catch {}
            }

            const headers = res.headers()

            // Capture Server-Timing header from main document response
            if (res.request().resourceType() === 'document') {
                const serverTiming = headers['server-timing']
                if (serverTiming) {
                    this.serverTimingHeader = serverTiming
                }
                this.pageCacheControl = headers['cache-control'] || null
                
                // Capture Deco observability headers
                this.decoPageHeader = headers['x-deco-page'] || null
                this.decoRouteHeader = headers['x-deco-route'] || null
                this.decoPlatformHeader = headers['x-deco-platform'] || null
            }

            // Track /deco/render requests (lazy loading)
            if (url.includes('/deco/render')) {
                this.pendingLazyRenders = Math.max(0, this.pendingLazyRenders - 1)
                
                const startTime = this.requests.get(id!)?.startTime || Date.now()
                const endTime = Date.now()
                const cacheControl = headers['cache-control'] || null
                const serverTiming = headers['server-timing'] || ''

                // Extract section name from x-deco-section header (preferred) or URL fallback
                const decoSectionHeader = headers['x-deco-section']
                const headerUsable = decoSectionHeader && !decoSectionHeader.includes('Rendering/')
                const sectionName = headerUsable ? decoSectionHeader : this.extractSectionName(url)

                // Parse server timing from this specific render request
                const loaderTimings = this.parseServerTimingString(serverTiming)

                // Check if cached
                const cached = this.isCached(cacheControl, res.status())
                
                // Get actual cache status from x-cache header
                const xCache = headers['x-cache'] || null

                this.lazyRenders.push({
                    url: url.substring(0, 100) + (url.length > 100 ? '...' : ''),
                    sectionName,
                    duration: endTime - startTime,
                    cached,
                    cacheStatus: xCache,
                    cacheControl,
                    serverTiming: loaderTimings,
                    status: res.status(),
                })
            }
        })

        this.page.on('requestfailed', (req: Request) => {
            const url = req.url()
            const id = this.requestToId.get(req)
            if (id) {
                const entry = this.requests.get(id)!
                entry.endTime = Date.now()
                entry.status = 0
            }
            if (url.includes('/deco/render')) {
                this.pendingLazyRenders = Math.max(0, this.pendingLazyRenders - 1)
            }
        })

        // Track errors
        this.page.on('console', (msg) => {
            if (msg.type() === 'error') this.errors.push(msg.text())
        })
        this.page.on('pageerror', (err) => this.errors.push(err.message))
    }

    private isCached(cacheControl: string | null, status: number): boolean {
        if (status === 304) return true
        if (!cacheControl) return false

        const hasMaxAge = /max-age=\d+/.test(cacheControl) && !/max-age=0/.test(cacheControl)
        const hasSMaxAge = /s-maxage=\d+/.test(cacheControl) && !/s-maxage=0/.test(cacheControl)
        const noStore = /no-store/.test(cacheControl)
        const noCache = /no-cache/.test(cacheControl)

        return (hasMaxAge || hasSMaxAge) && !noStore && !noCache
    }

    private extractSectionName(url: string): string {
        try {
            const urlObj = new URL(url, 'http://localhost')
            
            // Priority 1: Look in props for section type and title
            const props = urlObj.searchParams.get('props')
            if (props) {
                try {
                    const parsed = JSON.parse(decodeURIComponent(props))
                    const nameFromProps = this.extractNameFromProps(parsed)
                    if (nameFromProps) return nameFromProps
                } catch {}
            }

            // Priority 2: sectionId parameter
            const sectionId = urlObj.searchParams.get('sectionId')
            if (sectionId) {
                const cleaned = this.cleanName(sectionId)
                if (cleaned) return cleaned
            }

            // Priority 3: resolveChain
            const resolveChain = urlObj.searchParams.get('resolveChain')
            if (resolveChain) {
                try {
                    const chain = JSON.parse(decodeURIComponent(resolveChain))
                    if (Array.isArray(chain)) {
                        for (const item of chain) {
                            if (item.type === 'resolvable' && item.value) {
                                const val = String(item.value)
                                if (val.includes('sections/') || val.includes('Section')) {
                                    const cleaned = this.cleanName(val)
                                    if (cleaned) return cleaned
                                }
                            }
                        }
                    }
                } catch {}
            }

            // Priority 4: href parameter
            const href = urlObj.searchParams.get('href')
            if (href) {
                try {
                    const hrefUrl = new URL(href, 'http://localhost')
                    const match = hrefUrl.pathname.match(/\/section\/([^/]+)/)
                    if (match) {
                        const cleaned = this.cleanName(decodeURIComponent(match[1]))
                        if (cleaned) return cleaned
                    }
                } catch {}
            }

            // Priority 5: pathname
            const pathMatch = urlObj.pathname.match(/\/deco\/render\/([^/?]+)/)
            if (pathMatch) {
                const cleaned = this.cleanName(decodeURIComponent(pathMatch[1]))
                if (cleaned) return cleaned
            }

            // Fallback: renderSalt
            const renderSalt = urlObj.searchParams.get('renderSalt')
            if (renderSalt) {
                return `Section #${renderSalt}`
            }

            return 'Unknown Section'
        } catch {
            return 'Unknown Section'
        }
    }
    
    /**
     * Extract a meaningful name from section props
     */
    private extractNameFromProps(props: Record<string, unknown>): string | null {
        const section = props.section as Record<string, unknown> | undefined
        const target = section || props
        
        const resolveType = (target.__resolveType || target['__resolveType']) as string | undefined
        const componentName = resolveType ? this.cleanName(resolveType) : null
        
        const title = (target.title || target.name || target.label) as string | undefined
        
        const nestedTitle = (
            (target.props as Record<string, unknown>)?.title ||
            (target.content as Record<string, unknown>)?.title ||
            (target.header as Record<string, unknown>)?.title
        ) as string | undefined
        
        const displayTitle = title || nestedTitle
        
        if (componentName && displayTitle) {
            const shortTitle = displayTitle.length > 20 ? displayTitle.substring(0, 17) + '...' : displayTitle
            return `${componentName}: ${shortTitle}`
        }
        
        if (displayTitle) {
            return displayTitle.length > 30 ? displayTitle.substring(0, 27) + '...' : displayTitle
        }
        
        if (componentName) {
            return componentName
        }
        
        const collection = (
            (target.products as Record<string, unknown>)?.props as Record<string, unknown>
        )?.collection as string | undefined
        
        if (collection) {
            return `Products: ${collection.substring(0, 20)}`
        }
        
        return null
    }

    private cleanName(name: string): string {
        if (name.includes('Rendering/Lazy') || name.includes('Rendering/Deferred')) {
            return ''
        }
        
        return name
            .replace(/^site\//, '')
            .replace(/^website\//, '')
            .replace(/\.tsx$/, '')
            .replace(/^sections\//, '')
            .replace(/^islands\//, '')
            .replace(/Rendering\//, '')
    }

    startMeasurement(): void {
        this.requests.clear()
        this.requestIdCounter = 0
        this.errors = []
        this.serverTimingHeader = null
        this.pageCacheControl = null
        this.lazyRenders = []
        this.pendingLazyRenders = 0
        this.startTime = Date.now()
        this.decoPageHeader = null
        this.decoRouteHeader = null
        this.decoPlatformHeader = null
    }

    /**
     * Dismiss any popups/modals that might block scrolling
     */
    private async dismissPopups(): Promise<void> {
        await this.page.evaluate(() => {
            document.querySelectorAll('[class*="pushnews"], [id*="pushnews"], [class*="pn-"]').forEach(el => el.remove())

            document.querySelectorAll('button').forEach(btn => {
                const text = btn.textContent || ''
                if (text.includes('obrigado') || text.includes('quero') || text.includes('Aceitar')) {
                    let parent = btn.parentElement
                    for (let i = 0; i < 10 && parent; i++) {
                        const style = window.getComputedStyle(parent)
                        if (style.position === 'fixed' || style.position === 'absolute') {
                            parent.remove()
                            break
                        }
                        parent = parent.parentElement
                    }
                }
            })
        }).catch(() => {})
    }

    /**
     * Scroll down the page to trigger lazy loading
     * STRICT QUEUE: Only one /deco/render at a time
     */
    async scrollPage(options: { full?: boolean; footerSelector?: string; maxTime?: number } = {}): Promise<number> {
        const { full = false, footerSelector = 'footer', maxTime = 30000 } = options
        const initialRenders = this.lazyRenders.length
        const startTime = Date.now()

        await this.page.waitForTimeout(1000)
        await this.dismissPopups()

        if (!full) {
            for (let i = 0; i < 3; i++) {
                await this.page.evaluate(() => window.scrollBy(0, 500)).catch(() => {})
                await this.page.waitForTimeout(300)
            }
            return this.lazyRenders.length - initialRenders
        }

        const scrollStep = 200
        let stuckSectionCount = 0
        const maxStuckSections = 2
        
        for (let i = 0; i < 300; i++) {
            if (this.page.isClosed()) break

            const elapsed = Date.now() - startTime
            if (elapsed > maxTime) {
                console.log(`      ⏱️  Scroll timeout (${Math.round(elapsed / 1000)}s) - stopping`)
                break
            }

            if (this.pendingLazyRenders > 0) {
                console.log(`      ⏳ Waiting for ${this.pendingLazyRenders} pending render before next scroll...`)
                await this.waitForPendingRenders(8000)
                
                if (this.pendingLazyRenders > 0) {
                    stuckSectionCount++
                    console.log(`      ⚠️  Section STUCK (${stuckSectionCount}/${maxStuckSections}) - will skip`)
                    this.pendingLazyRenders = 0
                    
                    if (stuckSectionCount >= maxStuckSections) {
                        console.log(`      🛑 Too many stuck sections - stopping scroll`)
                        break
                    }
                    
                    await this.page.waitForTimeout(1000)
                }
                
                await this.page.waitForTimeout(500)
                continue
            }

            const footerVisible = await this.page.locator(footerSelector).first().isVisible().catch(() => false)
            if (footerVisible) {
                console.log(`      ✅ Footer visible after ${i} scrolls`)
                break
            }

            if (i < 5) await this.dismissPopups()

            await this.page.evaluate((step) => window.scrollBy(0, step), scrollStep).catch(() => {})
            await this.page.waitForTimeout(100)

            const atBottom = await this.page.evaluate(() => {
                return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 20
            }).catch(() => false)

            if (atBottom) {
                if (this.pendingLazyRenders > 0) {
                    await this.waitForPendingRenders(3000)
                    this.pendingLazyRenders = 0
                }
                
                const footerNow = await this.page.locator(footerSelector).first().isVisible().catch(() => false)
                console.log(footerNow ? `      ✅ Footer visible at bottom` : `      ⚠️  At bottom, no footer`)
                break
            }
        }

        return this.lazyRenders.length - initialRenders
    }

    private async waitForPendingRenders(maxWait: number): Promise<void> {
        const startTime = Date.now()
        
        while (this.pendingLazyRenders > 0 && Date.now() - startTime < maxWait) {
            await this.page.waitForTimeout(100)
        }
        
        if (this.pendingLazyRenders > 0) {
            console.log(`      ⚠️  Timeout waiting for ${this.pendingLazyRenders} render(s)`)
        }
    }

    async collectPageMetrics(pageName: string): Promise<PageMetrics> {
        if (this.page.isClosed()) {
            console.log('      ⚠️  Page was closed before collecting metrics')
            return this.getEmptyMetrics(pageName)
        }

        await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
        if (this.page.isClosed()) return this.getEmptyMetrics(pageName)
        await this.page.waitForTimeout(500).catch(() => {})

        const serverTiming = this.parseServerTiming()
        const cacheAnalysis = this.analyzeCaching(serverTiming)

        return {
            url: this.page.url(),
            pageName,
            timestamp: new Date().toISOString(),
            performance: await this.getPerformance(),
            network: this.getNetwork(),
            serverTiming,
            cacheAnalysis,
            renderTime: Date.now() - this.startTime,
            errors: [...this.errors],
            decoHeaders: {
                page: this.decoPageHeader,
                route: this.decoRouteHeader,
                platform: this.decoPlatformHeader,
            },
        }
    }

    private analyzeCaching(serverTiming: ServerTimingMetrics): CacheAnalysis {
        const warnings: string[] = []
        const pageCached = this.isCached(this.pageCacheControl, 200)

        const lazyRendersCached = this.lazyRenders.filter(r => r.cached).length
        const lazyRendersUncached = this.lazyRenders.filter(r => !r.cached).length

        const serverSideLoaders = serverTiming.slowestLoaders.filter(l => l.duration > 0)

        if (!pageCached && serverSideLoaders.length > 0) {
            const slowLoaders = serverSideLoaders.filter(l => l.duration > 50)
            if (slowLoaders.length > 0) {
                warnings.push(
                    `⚠️ Page is NOT cached but has ${slowLoaders.length} slow loader(s) on SSR. ` +
                    `Consider moving loaders to lazy sections or adding cache.`
                )
            }
        }

        if (serverSideLoaders.length > 10) {
            warnings.push(
                `⚠️ ${serverSideLoaders.length} loaders running on SSR. ` +
                `Consider lazy loading more sections.`
            )
        }

        if (lazyRendersUncached > 0) {
            warnings.push(
                `⚠️ ${lazyRendersUncached} lazy render(s) without cache. ` +
                `Add cache-control headers.`
            )
        }

        const verySlowLoaders = serverSideLoaders.filter(l => l.duration > 200)
        if (verySlowLoaders.length > 0) {
            warnings.push(
                `🐢 ${verySlowLoaders.length} very slow loader(s) (>200ms) on SSR: ` +
                verySlowLoaders.map(l => `${l.name} (${l.duration}ms)`).join(', ')
            )
        }

        return {
            pageUrl: this.page.url(),
            pageCached,
            pageCacheControl: this.pageCacheControl,
            lazyRenders: [...this.lazyRenders],
            lazyRendersCached,
            lazyRendersUncached,
            serverSideLoaders,
            warnings,
        }
    }

    private parseServerTiming(): ServerTimingMetrics {
        return this.parseServerTimingToMetrics(this.serverTimingHeader)
    }

    private parseServerTimingToMetrics(header: string | null): ServerTimingMetrics {
        const loaders: LoaderTiming[] = []
        const cacheStats = { total: 0, bypass: 0, hit: 0, miss: 0, stale: 0 }

        if (!header) {
            return {
                loaders: [],
                totalServerTime: 0,
                slowestLoaders: [],
                cacheStats,
            }
        }

        const entries = header.split(/,\s*/)

        for (const entry of entries) {
            const parsed = this.parseServerTimingEntry(entry.trim())
            if (parsed) {
                loaders.push(parsed)
                cacheStats.total++

                if (parsed.status) {
                    const statusLower = parsed.status.toLowerCase()
                    if (statusLower === 'bypass') cacheStats.bypass++
                    else if (statusLower === 'hit') cacheStats.hit++
                    else if (statusLower === 'miss') cacheStats.miss++
                    else if (statusLower === 'stale') cacheStats.stale++
                }
            }
        }

        const totalServerTime = loaders
            .filter(l => l.name !== 'render-to-string')
            .reduce((sum, l) => sum + l.duration, 0)

        const slowestLoaders = [...loaders]
            .filter(l => !['router', 'render-to-string', 'load-data', 'cfExtPri'].includes(l.name))
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10)

        return {
            loaders,
            totalServerTime,
            slowestLoaders,
            cacheStats,
        }
    }

    private parseServerTimingString(header: string): LoaderTiming[] {
        if (!header) return []

        const entries = header.split(/,\s*/)
        return entries
            .map(entry => this.parseServerTimingEntry(entry.trim()))
            .filter((e): e is LoaderTiming => e !== null)
    }

    private parseServerTimingEntry(entry: string): LoaderTiming | null {
        if (!entry) return null

        const parts = entry.split(';')
        if (parts.length === 0) return null

        const rawName = parts[0]
        const name = this.decodeLoaderName(rawName)

        let duration = 0
        let status: string | null = null

        for (let i = 1; i < parts.length; i++) {
            const part = parts[i].trim()
            if (part.startsWith('dur=')) {
                duration = parseFloat(part.substring(4)) || 0
            } else if (part.startsWith('desc=')) {
                status = part.substring(5).replace(/^"|"$/g, '')
            }
        }

        return { name, duration, status }
    }

    private decodeLoaderName(raw: string): string {
        try {
            let decoded = decodeURIComponent(raw)
            try {
                decoded = decodeURIComponent(decoded)
            } catch {}

            decoded = decoded
                .replace(/@/g, ' → ')
                .replace(/\.variants\.\d+\.value\./g, '.')
                .replace(/\.section\./g, '.')
                .replace(/pages-/g, '')
                .replace(/-[a-f0-9]{8,}/g, '')

            return decoded
        } catch {
            return raw
        }
    }

    private async getPerformance(): Promise<PerformanceMetrics> {
        const data = await this.page.evaluate(() => {
            const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
            const fcp = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint')
            const lcpEntries = performance.getEntriesByType('largest-contentful-paint')
            const lcp = lcpEntries[lcpEntries.length - 1] as PerformanceEntry & { startTime: number }

            const layoutShifts = performance.getEntriesByType('layout-shift') as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>
            const cls = layoutShifts.filter(e => !e.hadRecentInput).reduce((sum, e) => sum + e.value, 0)

            return {
                TTFB: nav?.responseStart - nav?.requestStart || null,
                domContentLoaded: nav?.domContentLoadedEventEnd - nav?.startTime || null,
                FCP: fcp?.startTime || null,
                LCP: lcp?.startTime || null,
                CLS: cls,
            }
        })

        return {
            TTFB: data.TTFB,
            FCP: data.FCP,
            LCP: data.LCP,
            CLS: data.CLS,
            domContentLoaded: data.domContentLoaded,
        }
    }

    private getNetwork(): NetworkMetrics {
        const entries = [...this.requests.values()]
        const totalBytes = entries.reduce((sum, e) => sum + e.size, 0)

        const slowest = entries
            .filter(e => e.endTime)
            .map(e => ({
                url: e.url.slice(0, 80),
                duration: (e.endTime || 0) - e.startTime,
                type: e.type,
            }))
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 5)

        return {
            totalRequests: entries.length,
            totalBytes,
            totalBytesFormatted: this.formatBytes(totalBytes),
            slowestRequests: slowest,
            failedRequests: entries.filter(e => e.status === 0).length,
        }
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
    }

    async cleanup(): Promise<void> {
        await this.cdp?.detach().catch(() => {})
    }

    private getEmptyMetrics(pageName: string): PageMetrics {
        return {
            url: 'page-closed',
            pageName,
            timestamp: new Date().toISOString(),
            performance: { LCP: null, FCP: null, CLS: null, TTFB: null, domContentLoaded: null },
            network: { totalRequests: 0, totalBytes: 0, totalBytesFormatted: '0 B', slowestRequests: [], failedRequests: 0 },
            serverTiming: { loaders: [], totalServerTime: 0, slowestLoaders: [], cacheStats: { total: 0, bypass: 0, hit: 0, miss: 0, stale: 0 } },
            cacheAnalysis: { pageUrl: 'page-closed', pageCached: false, pageCacheControl: null, lazyRenders: [], lazyRendersCached: 0, lazyRendersUncached: 0, serverSideLoaders: [], warnings: ['Page was closed before metrics collection'] },
            renderTime: 0,
            errors: ['Page was closed'],
            decoHeaders: { page: null, route: null, platform: null },
        }
    }
}

/**
 * Format loader timings for beautiful console output
 */
export function formatLoaderTimings(serverTiming: ServerTimingMetrics): string[] {
    const lines: string[] = []

    if (serverTiming.loaders.length === 0) {
        lines.push('   ⚡ Server Timing: 0ms total (1 loaders)')
        return lines
    }

    const { bypass, hit, miss, stale } = serverTiming.cacheStats
    const cacheInfo: string[] = []
    if (hit > 0) cacheInfo.push(`💾${hit}`)
    if (miss > 0) cacheInfo.push(`❌${miss}`)
    if (stale > 0) cacheInfo.push(`⏳${stale}`)
    if (bypass > 0) cacheInfo.push(`⏭️${bypass}`)
    
    const cacheStr = cacheInfo.length > 0 ? ` [${cacheInfo.join(' ')}]` : ''
    lines.push(`   ⚡ Server Timing: ${serverTiming.totalServerTime.toFixed(0)}ms total (${serverTiming.loaders.length} loaders)${cacheStr}`)

    if (serverTiming.loaders.length > 0) {
        lines.push('   ┌───────────────────────────────────────────────────────────')

        const sorted = [...serverTiming.loaders].sort((a, b) => b.duration - a.duration)

        for (const loader of sorted.slice(0, 12)) {
            const speedIcon = loader.duration < 50 ? '🟢' : loader.duration < 200 ? '🟡' : '🔴'
            let cacheIcon = '  '
            if (loader.status === 'HIT') cacheIcon = '💾'
            else if (loader.status === 'MISS') cacheIcon = '❌'
            else if (loader.status === 'STALE') cacheIcon = '⏳'
            else if (loader.status === 'bypass') cacheIcon = '⏭️'
            
            const name = loader.name.length > 30 ? loader.name.substring(0, 27) + '...' : loader.name.padEnd(30)
            const status = loader.status ? `[${loader.status}]` : ''

            lines.push(`   │ ${speedIcon} ${name} ${loader.duration.toFixed(0).padStart(5)}ms ${cacheIcon} ${status}`)
        }

        if (serverTiming.loaders.length > 12) {
            lines.push(`   │ ... and ${serverTiming.loaders.length - 12} more loaders`)
        }

        lines.push('   └───────────────────────────────────────────────────────────')
    }

    return lines
}

/**
 * Format lazy render analysis for console output
 */
export function formatLazyRenderAnalysis(cacheAnalysis: CacheAnalysis): string[] {
    const lines: string[] = []

    const pageIcon = cacheAnalysis.pageCached ? '✅' : '❌'
    lines.push(`   ${pageIcon} Page Cache: ${cacheAnalysis.pageCached ? 'CACHED' : 'NOT CACHED'}`)
    if (cacheAnalysis.pageCacheControl && cacheAnalysis.pageCached) {
        lines.push(`      Cache-Control: ${cacheAnalysis.pageCacheControl.substring(0, 60)}...`)
    }

    if (cacheAnalysis.serverSideLoaders.length > 0) {
        lines.push('')
        lines.push(`   🖥️  SSR Loaders (${cacheAnalysis.serverSideLoaders.length}):`)
        lines.push('   ┌───────────────────────────────────────────────────────────')
        for (const loader of cacheAnalysis.serverSideLoaders.slice(0, 10)) {
            const speedIcon = loader.duration < 50 ? '🟢' : loader.duration < 200 ? '🟡' : '🔴'
            const cacheIcon = loader.status === 'HIT' ? '💾' : loader.status === 'STALE' ? '⏳' : loader.status === 'MISS' ? '❌' : '⏭️'
            const name = loader.name.length > 30 ? loader.name.substring(0, 27) + '...' : loader.name.padEnd(30)
            const status = loader.status ? `[${loader.status}]` : ''
            lines.push(`   │ ${speedIcon} ${name} ${loader.duration.toString().padStart(4)}ms ${cacheIcon} ${status}`)
        }
        if (cacheAnalysis.serverSideLoaders.length > 10) {
            lines.push(`   │ ... and ${cacheAnalysis.serverSideLoaders.length - 10} more loaders`)
        }
        lines.push('   └───────────────────────────────────────────────────────────')
    }

    if (cacheAnalysis.lazyRenders.length > 0) {
        lines.push('')
        lines.push(`   🔄 Lazy Sections (${cacheAnalysis.lazyRenders.length}):`)
        lines.push('   ┌───────────────────────────────────────────────────────────')
        
        const sorted = [...cacheAnalysis.lazyRenders].sort((a, b) => b.duration - a.duration)
        
        for (const render of sorted.slice(0, 15)) {
            const speedIcon = render.duration < 100 ? '🟢' : render.duration < 500 ? '🟡' : '🔴'
            let cacheIcon = '  '
            let cacheText = ''
            if (render.cacheStatus) {
                cacheText = render.cacheStatus
                if (render.cacheStatus === 'HIT') cacheIcon = '💾'
                else if (render.cacheStatus === 'MISS') cacheIcon = '❌'
                else if (render.cacheStatus === 'STALE') cacheIcon = '⏳'
                else if (render.cacheStatus === 'DYNAMIC') cacheIcon = '🔄'
            } else if (render.cached) {
                cacheIcon = '💾'
                cacheText = 'cached'
            }
            const name = render.sectionName.length > 26 ? render.sectionName.substring(0, 23) + '...' : render.sectionName.padEnd(26)
            
            lines.push(`   │ ${speedIcon} ${name} ${render.duration.toString().padStart(5)}ms ${cacheIcon} ${cacheText}`)
        }
        
        if (cacheAnalysis.lazyRenders.length > 15) {
            lines.push(`   │ ... and ${cacheAnalysis.lazyRenders.length - 15} more sections`)
        }
        lines.push('   └───────────────────────────────────────────────────────────')
        
        const fast = cacheAnalysis.lazyRenders.filter(r => r.duration < 100).length
        const medium = cacheAnalysis.lazyRenders.filter(r => r.duration >= 100 && r.duration < 500).length
        const slow = cacheAnalysis.lazyRenders.filter(r => r.duration >= 500).length
        const totalTime = cacheAnalysis.lazyRenders.reduce((sum, r) => sum + r.duration, 0)
        
        lines.push(`   📊 Summary: ${fast} fast, ${medium} medium, ${slow} slow │ Total: ${totalTime}ms`)
        
        if (cacheAnalysis.lazyRendersUncached > 0) {
            lines.push(`   ⚠️  ${cacheAnalysis.lazyRendersUncached} uncached - add cache headers!`)
        }
    }

    if (cacheAnalysis.warnings.length > 0) {
        lines.push('')
        lines.push('   ⚠️  WARNINGS:')
        for (const warning of cacheAnalysis.warnings) {
            lines.push(`      ${warning}`)
        }
    }

    return lines
}

/**
 * Get a summary of loader timings for compact display
 */
export function getLoaderSummary(serverTiming: ServerTimingMetrics): string {
    if (serverTiming.loaders.length === 0) return 'No timing data'

    const count = serverTiming.loaders.length
    const slowest = serverTiming.slowestLoaders[0]
    const slowestInfo = slowest ? `slowest: ${slowest.name.substring(0, 20)}... (${slowest.duration}ms)` : ''

    return `${count} loaders, ${serverTiming.totalServerTime}ms total${slowestInfo ? ', ' + slowestInfo : ''}`
}
