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
import { clamp, createUniverseSeed } from './math.js';
import { latentTrail }        from './latentMap.js';
import { updateText }         from './ui.js';

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
    const row = document.getElementById('frosted-blur-row');
    if (row) row.style.opacity = isFrosted ? '1' : '.45';
    const input = document.getElementById('frosted-blur');
    if (input) input.value = String(AppState.frostedBlur);
    updateText('frosted-blur-value', `${AppState.frostedBlur}px`);
}

export function setWallpaperMode(mode) {
    if (!['normal', 'frosted'].includes(mode)) return;
    AppState.wallpaperMode = mode;
    applyWallpaperDisplay();
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
    if (!['growth', 'universe'].includes(mode)) return;
    AppState.wallpaperRandomMode = mode;
    AppState.lastWallpaperSwitch = performance.now();
    document.getElementById('growth-mode-btn')?.classList.toggle('active',   mode === 'growth');
    document.getElementById('universe-mode-btn')?.classList.toggle('active', mode === 'universe');
    saveState();
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
    } else {
        const speed = (AppState.lastParams?.stepMod ?? 0.04)
                    * Math.max(AppState.randomnessLevel, 0.2);
        AppState.currentEntity.step(speed);
    }
    AppState.generationCount++;
}

export function nextWallpaper() {
    if (!AppState.currentEntity || !AppState.universeDecoder) return;
    advanceWallpaper();
    AppState.lastWallpaperSwitch = performance.now();
    drawArt(getCanvas(), AppState.currentEntity);
    updateText('gen-counter', AppState.generationCount);
    saveState();
}
