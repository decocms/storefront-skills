#!/usr/bin/env -S deno run -A
/**
 * Baseline Management Script
 * ==========================
 * Save current test results as baseline and compare against it.
 *
 * Usage:
 *   deno run -A scripts/baseline.ts save [name]
 *   deno run -A scripts/baseline.ts compare [name]
 *   deno run -A scripts/baseline.ts list
 *   deno run -A scripts/baseline.ts delete <name>
 */

import { ensureDirSync, existsSync } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { join, dirname, fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";

interface PerformanceMetrics {
    TTFB: number | null
    FCP: number | null
    LCP: number | null
    CLS: number | null
}

interface PageMetrics {
    pageName: string
    performance: PerformanceMetrics
    network: { totalRequests: number; totalBytes: number }
}

interface Report {
    metrics: PageMetrics[]
    timestamp: string
    savedAt?: string
    name?: string
}

interface ComparisonResult {
    pageName: string
    metric: string
    baseline: number
    current: number
    diff: number
    diffPercent: number
    status: 'improved' | 'regressed' | 'unchanged'
}

const SCRIPT_DIR = dirname(fromFileUrl(import.meta.url))
const REPORTS_DIR = join(SCRIPT_DIR, '..', 'reports')
const BASELINES_DIR = join(REPORTS_DIR, 'baselines')
const LATEST_REPORT = join(REPORTS_DIR, 'report-latest.json')
const DEFAULT_BASELINE = join(BASELINES_DIR, 'baseline.json')

// Threshold percentages for regression detection
const THRESHOLDS: Record<string, number> = {
    TTFB: 10,    // 10% slower = regression
    FCP: 10,
    LCP: 15,
    CLS: 50,     // CLS is more variable
}

function loadReport(filepath: string): Report | null {
    try {
        const content = Deno.readTextFileSync(filepath)
        return JSON.parse(content)
    } catch {
        return null
    }
}

function saveBaseline(name?: string): void {
    ensureDirSync(BASELINES_DIR)

    const latest = loadReport(LATEST_REPORT)
    if (!latest) {
        console.error('❌ No report found at', LATEST_REPORT)
        console.error('   Run the e2e tests first: deno task test:e2e')
        Deno.exit(1)
    }

    const targetPath = name
        ? join(BASELINES_DIR, `baseline-${name}.json`)
        : DEFAULT_BASELINE

    const baseline: Report = {
        ...latest,
        savedAt: new Date().toISOString(),
        name: name || 'default',
    }

    Deno.writeTextFileSync(targetPath, JSON.stringify(baseline, null, 2))
    console.log(`✅ Baseline saved: ${targetPath}`)
    console.log(`   Timestamp: ${latest.timestamp}`)
    console.log(`   Pages: ${latest.metrics.map(m => m.pageName).join(', ')}`)
}

function listBaselines(): void {
    ensureDirSync(BASELINES_DIR)

    let files: string[] = []
    try {
        files = [...Deno.readDirSync(BASELINES_DIR)]
            .filter(f => f.isFile && f.name.endsWith('.json'))
            .map(f => f.name)
    } catch {
        // Directory might not exist yet
    }

    if (files.length === 0) {
        console.log('📋 No baselines saved yet')
        console.log('   Save one with: deno task test:e2e:baseline:save')
        return
    }

    console.log('📋 Saved baselines:\n')
    for (const file of files) {
        const filepath = join(BASELINES_DIR, file)
        const baseline = loadReport(filepath)
        if (baseline) {
            const name = file.replace('baseline-', '').replace('.json', '')
            console.log(`   ${name}`)
            console.log(`      Saved: ${baseline.savedAt || baseline.timestamp}`)
            console.log(`      Pages: ${baseline.metrics.length}`)
            console.log('')
        }
    }
}

function deleteBaseline(name: string): void {
    const targetPath = name === 'default'
        ? DEFAULT_BASELINE
        : join(BASELINES_DIR, `baseline-${name}.json`)

    if (!existsSync(targetPath)) {
        console.error(`❌ Baseline not found: ${name}`)
        Deno.exit(1)
    }

    Deno.removeSync(targetPath)
    console.log(`✅ Deleted baseline: ${name}`)
}

function compare(baselineName?: string): void {
    const baselinePath = baselineName
        ? join(BASELINES_DIR, `baseline-${baselineName}.json`)
        : DEFAULT_BASELINE

    const baseline = loadReport(baselinePath)
    if (!baseline) {
        console.error('❌ No baseline found at', baselinePath)
        console.error('   Save a baseline first: deno task test:e2e:baseline:save')
        Deno.exit(1)
    }

    const current = loadReport(LATEST_REPORT)
    if (!current) {
        console.error('❌ No current report found at', LATEST_REPORT)
        console.error('   Run the e2e tests first: deno task test:e2e')
        Deno.exit(1)
    }

    console.log('📊 Performance Comparison\n')
    console.log(`   Baseline: ${baseline.savedAt || baseline.timestamp}`)
    console.log(`   Current:  ${current.timestamp}\n`)

    const results: ComparisonResult[] = []
    let hasRegression = false

    // Compare each page
    for (const currentPage of current.metrics) {
        const baselinePage = baseline.metrics.find(m => m.pageName === currentPage.pageName)
        if (!baselinePage) continue

        // Compare key metrics
        for (const metric of ['TTFB', 'FCP', 'LCP'] as const) {
            const baseVal = baselinePage.performance[metric]
            const currVal = currentPage.performance[metric]

            if (baseVal === null || currVal === null) continue

            const diff = currVal - baseVal
            const diffPercent = (diff / baseVal) * 100
            const threshold = THRESHOLDS[metric]

            let status: 'improved' | 'regressed' | 'unchanged'
            if (diffPercent < -threshold) {
                status = 'improved'
            } else if (diffPercent > threshold) {
                status = 'regressed'
                hasRegression = true
            } else {
                status = 'unchanged'
            }

            results.push({
                pageName: currentPage.pageName,
                metric,
                baseline: baseVal,
                current: currVal,
                diff,
                diffPercent,
                status,
            })
        }
    }

    // Print results grouped by page
    const pageNames = [...new Set(results.map(r => r.pageName))]
    for (const pageName of pageNames) {
        console.log(`   ${pageName}`)
        const pageResults = results.filter(r => r.pageName === pageName)

        for (const r of pageResults) {
            const icon = r.status === 'improved' ? '✅' : r.status === 'regressed' ? '❌' : '➖'
            const sign = r.diff > 0 ? '+' : ''
            const diffStr = `${sign}${r.diff.toFixed(0)}ms (${sign}${r.diffPercent.toFixed(1)}%)`

            console.log(`      ${icon} ${r.metric}: ${r.baseline.toFixed(0)}ms → ${r.current.toFixed(0)}ms ${diffStr}`)
        }
        console.log('')
    }

    // Summary
    const improved = results.filter(r => r.status === 'improved').length
    const regressed = results.filter(r => r.status === 'regressed').length
    const unchanged = results.filter(r => r.status === 'unchanged').length

    console.log('   Summary:')
    console.log(`      ✅ Improved: ${improved}`)
    console.log(`      ❌ Regressed: ${regressed}`)
    console.log(`      ➖ Unchanged: ${unchanged}`)

    if (hasRegression) {
        console.log('\n⚠️  Performance regressions detected!')
        Deno.exit(1)
    } else {
        console.log('\n✅ No regressions detected')
    }
}

// CLI
const [command, arg] = Deno.args

switch (command) {
    case 'save':
        saveBaseline(arg)
        break
    case 'compare':
        compare(arg)
        break
    case 'list':
        listBaselines()
        break
    case 'delete':
        if (!arg) {
            console.error('❌ Please specify baseline name to delete')
            Deno.exit(1)
        }
        deleteBaseline(arg)
        break
    default:
        console.log(`
Baseline Management Script
==========================

Commands:
  save [name]      Save current report as baseline (default name: "default")
  compare [name]   Compare current report against baseline
  list             List all saved baselines
  delete <name>    Delete a specific baseline

Examples:
  deno task test:e2e:baseline:save
  deno task test:e2e:baseline:compare

  # With names:
  deno run -A scripts/baseline.ts save pre-release
  deno run -A scripts/baseline.ts compare pre-release
`)
}
