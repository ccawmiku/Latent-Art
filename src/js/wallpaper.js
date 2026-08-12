/**
 * wallpaper.js — Wallpaper Engine integration helpers.
 * Handles display mode (fill/square), random mode (growth/universe), timed
 * switching, and the "next" action.
 */

import { AppState }          from './appState.js';
import { drawArt, getCanvas } from './renderer.js';
import { saveState }          from './state.js';
import { DecoderNetwork }     from './decoder.js';
import { LatentEntity }       from './entity.js';
import { clamp, createUniverseSeed, randNormal } from './math.js';
import { LATENT_DIM, STRIPE_BACKGROUND }        from './constants.js';
import { latentTrail }        from './latentMap.js';
import { updateText, syncControlUI } from './ui.js';

// ── Display mode ──────────────────────────────────────────────────────────

export function applyWallpaperDisplay(redraw = true) {
    const frame  = document.getElementById('art-frame') || document.querySelector('.art-frame');
    const canvas = getCanvas();
    if (!frame || !canvas) return;

    // Frosted mode forces fullscreen fill; display buttons below reflect it.
    const isFrosted = AppState.wallpaperMode === 'frosted';

    frame.id = 'art-frame';
    frame.classList.toggle('square', AppState.wallpaperDisplayMode === 'square' && !isFrosted);
    document.body.style.backgroundColor = AppState.wallpaperOuterColor;
    frame.style.setProperty('--outer-bg', AppState.wallpaperOuterColor);

    const dpr    = Math.min(window.devicePixelRatio || 1, 2);
    const square = AppState.wallpaperDisplayMode === 'square' && !isFrosted;
    const side   = Math.max(480, Math.floor(Math.min(innerWidth, innerHeight) * 0.92 * dpr));
    canvas.width  = square ? side : Math.max(720, Math.floor(innerWidth  * dpr));
    canvas.height = square ? side : Math.max(480, Math.floor(innerHeight * dpr));

    document.getElementById('fill-mode-btn')?.classList.toggle('active', !square);
    document.getElementById('square-mode-btn')?.classList.toggle('active', square);

    const row = document.getElementById('outer-color-row');
    if (row) row.style.opacity = square ? '1' : '.45';

    applyFrostedUI();

    if (redraw && AppState.currentEntity) drawArt(canvas, AppState.currentEntity);
}

// ── Frosted (雾面) effect UI sync ─────────────────────────────────────────

function applyFrostedUI() {
    const isFrosted = AppState.wallpaperMode === 'frosted';
    document.body.classList.toggle('frosted', isFrosted);
    document.getElementById('mode-normal-btn')?.classList.toggle('active',  !isFrosted);
    document.getElementById('mode-frosted-btn')?.classList.toggle('active', isFrosted);
    const overlay = document.getElementById('frosted-overlay');
    if (overlay) overlay.style.setProperty('--frosted-blur', `${AppState.frostedBlur}px`);
    const input = document.getElementById('frosted-blur');
    if (input) input.value = String(AppState.frostedBlur);
    updateText('frosted-blur-value', `${AppState.frostedBlur}px`);
}

export function setWallpaperMode(mode) {
    if (!['normal', 'frosted'].includes(mode)) return;
    AppState.wallpaperMode = mode;
    applyWallpaperDisplay();
    syncControlUI();
    saveState();
}

export function setFrostedBlur(value) {
    const v = clamp(Math.round(Number(value) || 0), 0, 40);
    if (v === AppState.frostedBlur) return;
    AppState.frostedBlur = v;
    applyFrostedUI();
    saveState();
}

export function setWallpaperDisplayMode(mode) {
    if (!['fill', 'square'].includes(mode)) return;
    AppState.wallpaperDisplayMode = mode;
    applyWallpaperDisplay();
    saveState();
}

// ── Random mode ───────────────────────────────────────────────────────────

export function setWallpaperRandomMode(mode) {
    if (!['growth', 'universe', 'wipe', 'dim'].includes(mode)) return;
    AppState.wallpaperRandomMode = mode;
    AppState.lastWallpaperSwitch = performance.now();
    // Reset transient journey state on every mode switch
    AppState.growthStart     = null;
    AppState.growthDelta     = null;
    AppState.growthStepCount = 0;
    AppState.wipeTarget      = null;
    AppState.wipeCanvas      = null;
    AppState.wipeStepCount   = 0;
    AppState.dimTarget       = null;
    AppState.dimIndex        = 0;
    document.getElementById('growth-mode-btn')?.classList.toggle('active',   mode === 'growth');
    document.getElementById('universe-mode-btn')?.classList.toggle('active', mode === 'universe');
    document.getElementById('wipe-mode-btn')?.classList.toggle('active',     mode === 'wipe');
    document.getElementById('dim-mode-btn')?.classList.toggle('active',      mode === 'dim');
    syncControlUI();
    saveState();
}

// ── Growth-mode linear journey ────────────────────────────────────────────

/**
 * Start a new journey: freeze the current position as A, generate a random
 * target B, and precompute the A→B delta. The trajectory is a straight line.
 */
export function generateGrowthTarget() {
    const entity = AppState.currentEntity;
    if (!entity) return;
    AppState.growthStart = Float32Array.from(entity.z);
    const B = new Float32Array(LATENT_DIM);
    for (let i = 0; i < LATENT_DIM; i++) B[i] = randNormal() * 1.2;
    AppState.growthDelta = new Float32Array(LATENT_DIM);
    for (let i = 0; i < LATENT_DIM; i++) AppState.growthDelta[i] = B[i] - AppState.growthStart[i];
    AppState.growthStepCount = 0;
}

/**
 * One linear step of the journey: z = A + p·(1+overshoot)·(B−A). The landing
 * point extends past B by the overshoot fraction; on the final step that
 * landing position becomes the new A and a fresh B is generated in advance.
 */
export function growthAdvanceStep() {
    const entity = AppState.currentEntity;
    if (!entity) return;
    if (!AppState.growthStart || !AppState.growthDelta) generateGrowthTarget();
    const A  = AppState.growthStart;
    const D  = AppState.growthDelta;
    const z  = entity.z;
    const os = 1 + Math.min(AppState.growthOvershoot, 95) / 100;

    AppState.growthStepCount++;
    const p = Math.min(AppState.growthStepCount / AppState.growthSteps, 1);

    for (let i = 0; i < LATENT_DIM; i++) {
        z[i] = A[i] + p * os * D[i];
        if (z[i] >  5.5) z[i] =  5.5;
        if (z[i] < -5.5) z[i] = -5.5;
    }

    if (AppState.growthStepCount >= AppState.growthSteps) generateGrowthTarget();
}

export function setGrowthSteps(value) {
    const v = clamp(Math.round(Number(value) || 30), 5, 120);
    if (v === AppState.growthSteps) return;
    AppState.growthSteps = v;
    syncControlUI();
    saveState();
}

export function setGrowthOvershoot(value) {
    const v = clamp(Math.round(Number(value) || 0), 0, 100);
    if (v === AppState.growthOvershoot) return;
    AppState.growthOvershoot = v;
    syncControlUI();
    saveState();
}

// ── Wipe (逐条) journey — reveal target image's structural pieces ──────────

/**
 * Reveal units for the ORDERED mode (bottom→top draw order): the background
 * gaps first, then B's stripes in their recorded draw order (the parts array
 * is already sorted so later = on top). Each is a solid color fill, so top
 * stripes visibly cover bottom ones — matching the cover relations.
 */
function buildOrderedUnits(parts, w, h, edgeExpand) {
    const dilate   = n => Math.max(1, Math.round(n + (edgeExpand || 0)));
    const units    = [];
    const vStripes = parts.filter(p => p.dir === 'vertical').slice().sort((a, b) => a.pos - b.pos);

    // Background gaps — the bottom-most layer
    let cursor = 0;
    for (const s of vStripes) {
        const p   = Math.max(0, Math.round(s.pos));
        const end = Math.min(w, p + dilate(s.size));
        if (end <= p) continue;
        if (p > cursor) units.push({ kind: 'fill', color: STRIPE_BACKGROUND, x: cursor, y: 0, w: p - cursor, h });
        cursor = Math.max(cursor, end);
    }
    if (cursor < w) units.push({ kind: 'fill', color: STRIPE_BACKGROUND, x: cursor, y: 0, w: w - cursor, h });

    // Stripes in draw order (bottom to top)
    for (const s of parts) {
        if (s.dir === 'vertical') {
            units.push({ kind: 'fill', color: s.color, x: Math.round(s.pos), y: 0, w: dilate(s.size), h });
        } else {
            units.push({ kind: 'fill', color: s.color, x: 0, y: Math.round(s.pos), w, h: dilate(s.size) });
        }
    }
    return units;
}

/**
 * Reveal units for the RANDOM mode: B's vertical stripes + the gaps between
 * them + B's horizontal stripes, shuffled. Each is a region copied from B's
 * finished render (drawImage), so any crossing content is already correct.
 */
function buildRandomUnits(parts, w, h, edgeExpand) {
    const dilate   = n => Math.max(1, Math.round(n + (edgeExpand || 0)));
    const units    = [];
    const vStripes = parts.filter(p => p.dir === 'vertical').slice().sort((a, b) => a.pos - b.pos);
    const hStripes = parts.filter(p => p.dir === 'horizontal');

    let cursor = 0;
    for (const s of vStripes) {
        const p   = Math.max(0, Math.round(s.pos));
        const sw  = dilate(s.size);
        const end = Math.min(w, p + sw);
        if (end <= p) continue;
        if (p > cursor) units.push({ kind: 'region', x: cursor, y: 0, w: p - cursor, h });
        units.push({ kind: 'region', x: p, y: 0, w: end - p, h });
        cursor = Math.max(cursor, end);
    }
    if (cursor < w) units.push({ kind: 'region', x: cursor, y: 0, w: w - cursor, h });

    for (const s of hStripes) {
        const p  = Math.max(0, Math.round(s.pos));
        const sh = dilate(s.size);
        units.push({ kind: 'region', x: 0, y: p, w, h: Math.min(h, sh) });
    }
    return units;
}

function shuffleUnits(units) {
    for (let i = units.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [units[i], units[j]] = [units[j], units[i]];
    }
}

function generateWipeTarget() {
    const canvas = getCanvas();
    if (!canvas) return;
    const B = new Float32Array(LATENT_DIM);
    for (let i = 0; i < LATENT_DIM; i++) B[i] = randNormal() * 1.2;

    const off = document.createElement('canvas');
    off.width  = canvas.width;
    off.height = canvas.height;
    const temp = new LatentEntity();
    temp.z.set(B);
    AppState.lastParts      = null; // read B's parts, not a stale render
    AppState.lastEdgeExpand = 0;
    // Only the wipe target snaps to the structural grid; normal renders don't
    drawArt(off, temp, { updatePanels: false, cellSize: AppState.wipeCell });

    const parts = (Array.isArray(AppState.lastParts) && AppState.lastParts.length > 0) ? AppState.lastParts : null;
    let units = [];
    if (parts && AppState.wipeOrder === 'ordered') {
        units = buildOrderedUnits(parts, canvas.width, canvas.height, AppState.lastEdgeExpand);
    } else if (parts) {
        units = buildRandomUnits(parts, canvas.width, canvas.height, AppState.lastEdgeExpand);
        shuffleUnits(units);
    } else {
        // Fallback (non-stripe renderers): uniform vertical bands, random order
        const bandCount = Math.max(10, Math.min(60, Math.round(canvas.width / 40)));
        const bw        = Math.ceil(canvas.width / bandCount);
        for (let i = 0; i < bandCount; i++) {
            const x = i * bw;
            units.push({ kind: 'region', x, y: 0, w: Math.min(bw, canvas.width - x), h: canvas.height });
        }
        shuffleUnits(units);
    }

    AppState.wipeTarget    = B;
    AppState.wipeCanvas    = off;
    AppState.wipeUnits     = units;
    AppState.wipeStepCount = 0;
}

export function advanceWipe() {
    const canvas = getCanvas();
    if (!canvas || !AppState.currentEntity) return;
    if (!AppState.wipeTarget || !AppState.wipeCanvas || !AppState.wipeUnits) { generateWipeTarget(); return; }
    if (AppState.wipeCanvas.width !== canvas.width || AppState.wipeCanvas.height !== canvas.height) {
        generateWipeTarget();
        return;
    }

    const units = AppState.wipeUnits;
    if (AppState.wipeStepCount < units.length) {
        const u  = units[AppState.wipeStepCount];
        const ctx = canvas.getContext('2d');
        if (u.kind === 'fill') {
            ctx.fillStyle = u.color;
            ctx.fillRect(u.x, u.y, u.w, u.h);
        } else {
            ctx.drawImage(AppState.wipeCanvas, u.x, u.y, u.w, u.h, u.x, u.y, u.w, u.h);
        }
    }
    AppState.wipeStepCount++;

    if (AppState.wipeStepCount >= units.length) {
        AppState.currentEntity.z.set(AppState.wipeTarget);
        generateWipeTarget();
    }
}

export function setWipeOrder(order) {
    if (!['ordered', 'random'].includes(order)) return;
    if (order === AppState.wipeOrder) return;
    AppState.wipeOrder = order;
    // Restart the journey with the new reveal order (re-render target B)
    AppState.wipeTarget    = null;
    AppState.wipeCanvas    = null;
    AppState.wipeUnits     = null;
    AppState.wipeStepCount = 0;
    syncControlUI();
    saveState();
}

export function setWipeCell(cell) {
    if (![4, 8, 16, 32, 64].includes(cell)) return;
    if (cell === AppState.wipeCell) return;
    AppState.wipeCell = cell;
    // Restart the journey with the new grid (re-render target B)
    AppState.wipeTarget    = null;
    AppState.wipeCanvas    = null;
    AppState.wipeUnits     = null;
    AppState.wipeStepCount = 0;
    syncControlUI();
    saveState();
}

// ── Dim (逐维) journey — flip one latent dim to its target value per step ──

function generateDimTarget() {
    const B = new Float32Array(LATENT_DIM);
    for (let i = 0; i < LATENT_DIM; i++) B[i] = randNormal() * 1.2;
    AppState.dimTarget = B;
    AppState.dimIndex  = 0;
}

export function advanceDim() {
    const entity = AppState.currentEntity;
    if (!entity) return;
    if (!AppState.dimTarget) generateDimTarget();
    entity.z[AppState.dimIndex] = AppState.dimTarget[AppState.dimIndex];
    AppState.dimIndex++;
    if (AppState.dimIndex >= LATENT_DIM) generateDimTarget();
}

// ── Advance + next ────────────────────────────────────────────────────────

/** Advance the entity/universe one step (shared by timer and next button). */
export function advanceWallpaper() {
    if (!AppState.currentEntity || !AppState.universeDecoder) return;
    if (AppState.wallpaperRandomMode === 'universe') {
        AppState.universeSeed          = createUniverseSeed();
        AppState.universeDecoder       = new DecoderNetwork();
        AppState.currentEntity         = new LatentEntity();
        latentTrail.length             = 0;
        AppState.previousDecoderState  = null;
    } else if (AppState.wallpaperRandomMode === 'wipe') {
        advanceWipe();
    } else if (AppState.wallpaperRandomMode === 'dim') {
        advanceDim();
    } else {
        growthAdvanceStep();
    }
    AppState.generationCount++;
}

export function nextWallpaper() {
    if (!AppState.currentEntity || !AppState.universeDecoder) return;
    advanceWallpaper();
    AppState.lastWallpaperSwitch = performance.now();
    // Wipe draws its stripe inside advanceWipe — a full redraw would erase it
    if (AppState.wallpaperRandomMode !== 'wipe') drawArt(getCanvas(), AppState.currentEntity);
    updateText('gen-counter', AppState.generationCount);
    saveState();
}
