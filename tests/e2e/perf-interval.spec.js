/**
 * Performance test: measures render cost of a single drawArt() call.
 *
 * In the modular build the animation loop is switch-timer driven and calls the
 * module-scoped drawArt directly, so instrumenting the loop is not possible.
 * Instead this harness drives window.drawArt() itself at each target FPS
 * interval and measures per-call render cost.
 *
 * Metrics collected per FPS target:
 *   - renderMs.avg/p50/p95/p99/max: wall-clock time of one drawArt() call
 *   - effectiveFps: draws actually executed per second during sampling
 *   - jankFrames / jankRate: draws exceeding 2× the target interval budget
 *   - cpuMsPerSec: estimated CPU time consumed per wall-clock second
 *   - headroomPercent: (1 - avgRenderMs / targetIntervalMs) * 100
 *
 * Run with: npx playwright test tests/e2e/perf-interval.spec.js
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

// ── Test config ──────────────────────────────────────────────────────────────
const FPS_TARGETS = [1, 2, 4, 8, 15, 30, 60];
const SAMPLE_DURATION_MS = 6000; // how long to sample each FPS target
const WARMUP_MS = 1500;          // warmup before collecting

/** Compute the summary metrics from collected samples. */
function computeMetrics(samples, fpsTarget) {
    const renderTimes = samples.map(s => s.renderMs);
    renderTimes.sort((a, b) => a - b);
    const n = renderTimes.length;
    const avg = renderTimes.reduce((a, b) => a + b, 0) / n;
    const p50 = renderTimes[Math.floor(n * 0.5)];
    const p95 = renderTimes[Math.floor(n * 0.95)];
    const p99 = renderTimes[Math.floor(n * 0.99)];
    const max = renderTimes[n - 1];

    const actualDuration = (samples[n - 1].timestamp - samples[0].timestamp) / 1000;
    const effectiveFps = n / Math.max(actualDuration, 0.001);
    const budgetMs = 1000 / fpsTarget;
    const jankFrames = renderTimes.filter(t => t > budgetMs * 2).length;
    const missedFrames = renderTimes.filter(t => t > budgetMs).length;
    const cpuMsPerSec = avg * effectiveFps;

    const intervals = [];
    for (let i = 1; i < samples.length; i++) {
        intervals.push(samples[i].timestamp - samples[i - 1].timestamp);
    }
    intervals.sort((a, b) => a - b);
    const avgInterval = intervals.length > 0
        ? intervals.reduce((a, b) => a + b, 0) / intervals.length
        : 0;

    return {
        fpsTarget,
        sampleCount: n,
        actualDurationSec: Math.round(actualDuration * 100) / 100,
        effectiveFps: Math.round(effectiveFps * 10) / 10,
        targetIntervalMs: Math.round(budgetMs * 10) / 10,
        avgIntervalMs: Math.round(avgInterval * 100) / 100,
        renderMs: {
            avg: Math.round(avg * 100) / 100,
            min: Math.round(renderTimes[0] * 100) / 100,
            p50: Math.round(p50 * 100) / 100,
            p95: Math.round(p95 * 100) / 100,
            p99: Math.round(p99 * 100) / 100,
            max: Math.round(max * 100) / 100,
        },
        jankFrames,
        missedFrames,
        jankRate: Math.round((jankFrames / n) * 1000) / 10,
        cpuMsPerSec: Math.round(cpuMsPerSec * 100) / 100,
        headroomPercent: Math.round((1 - avg / budgetMs) * 1000) / 10,
    };
}

/** Drive window.drawArt() at the target FPS and collect per-call cost. */
async function measureAtFps(page, fpsTarget) {
    return page.evaluate(({ fpsTarget, sampleMs, warmupMs }) => {
        return new Promise((resolve) => {
            const canvas = document.getElementById('main-canvas');
            const entity = window.AppState?.currentEntity;
            if (!canvas || !entity || typeof window.drawArt !== 'function') {
                resolve(null);
                return;
            }

            const samples = [];
            let warmupDone = false;
            let warmupStart = performance.now();
            let timer = null;

            const drawOnce = () => {
                const t0 = performance.now();
                window.drawArt(canvas, entity, { updatePanels: false });
                const t1 = performance.now();

                if (!warmupDone) {
                    if (t1 - warmupStart >= warmupMs) warmupDone = true;
                    return;
                }

                samples.push({ renderMs: t1 - t0, timestamp: t1 });
                if (t1 - warmupStart - warmupMs >= sampleMs) {
                    clearInterval(timer);
                    if (samples.length === 0) { resolve(null); return; }
                    resolve(samples); // measured in node side
                }
            };

            const intervalMs = Math.max(8, 1000 / fpsTarget); // cap at ~125Hz
            timer = setInterval(drawOnce, intervalMs);
        });
    }, { fpsTarget, sampleMs: SAMPLE_DURATION_MS, warmupMs: WARMUP_MS })
        .then(samples => (samples ? computeMetrics(samples, fpsTarget) : null));
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Performance: drawArt render cost', () => {

    test('measure render cost across FPS targets and report', async ({ page }) => {
        test.setTimeout(180_000); // 3 minutes

        await page.goto('/');
        await page.waitForFunction(() => window.drawArt && typeof window.drawArt === 'function', null, { timeout: 15_000 });
        await page.waitForTimeout(2000);

        const allResults = [];

        for (const fps of FPS_TARGETS) {
            console.log(`  Measuring at ${fps} FPS (interval=${(1000 / fps).toFixed(1)}ms)...`);
            const result = await measureAtFps(page, fps);
            if (result) {
                allResults.push(result);
                console.log(`    → ${result.sampleCount} draws, avg render ${result.renderMs.avg}ms, `
                    + `effective ${result.effectiveFps} FPS, jank ${result.jankRate}%`);
            } else {
                console.log(`    → No data collected`);
            }
            await page.waitForTimeout(500);
        }

        // ── Print report ──────────────────────────────────────────────────────
        console.log('\n' + '='.repeat(90));
        console.log('PERFORMANCE REPORT: Target Interval vs Render Cost');
        console.log('='.repeat(90));
        console.log(
            'Target'.padStart(7),
            'Interval'.padStart(10),
            'AvgRender'.padStart(10),
            'P95'.padStart(8),
            'P99'.padStart(8),
            'Max'.padStart(8),
            'EffFPS'.padStart(8),
            'Jank%'.padStart(8),
            'CPUms/s'.padStart(9),
            'Headroom%'.padStart(10)
        );
        console.log('-'.repeat(90));

        for (const r of allResults) {
            console.log(
                `${r.fpsTarget}`.padStart(6) + 'fps',
                `${r.targetIntervalMs}ms`.padStart(9),
                `${r.renderMs.avg}ms`.padStart(9),
                `${r.renderMs.p95}ms`.padStart(7),
                `${r.renderMs.p99}ms`.padStart(7),
                `${r.renderMs.max}ms`.padStart(7),
                `${r.effectiveFps}`.padStart(7) + 'fps',
                `${r.jankRate}%`.padStart(7),
                `${r.cpuMsPerSec}ms`.padStart(9),
                `${r.headroomPercent}%`.padStart(10)
            );
        }

        console.log('-'.repeat(90));
        console.log('Notes:');
        console.log('  - Headroom% = (1 - avgRenderMs / targetIntervalMs) * 100');
        console.log('  - Negative headroom means render time exceeds target interval');
        console.log('  - Jank% = draws where render > 2× target interval');
        console.log('  - CPUms/s = avg render ms × effective FPS (estimated CPU time per second)');

        // ── Save JSON report ──────────────────────────────────────────────────
        const reportDir = path.resolve(import.meta.dirname, '..', '..', 'test-results');
        fs.mkdirSync(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, `perf-interval-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            config: { sampleDurationMs: SAMPLE_DURATION_MS, warmupMs: WARMUP_MS },
            results: allResults,
        }, null, 2));
        console.log(`\n  JSON report saved to: ${reportPath}`);

        // ── Assertions ────────────────────────────────────────────────────────
        expect(allResults.length).toBeGreaterThan(0);

        // A single drawArt() must be comfortably under the default 8 FPS budget
        const defaultResult = allResults.find(r => r.fpsTarget === 8);
        if (defaultResult) {
            expect(defaultResult.renderMs.avg).toBeLessThan(1000 / 8); // under budget
        }
    });

});
