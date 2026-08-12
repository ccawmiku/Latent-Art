/**
 * controls.js — DOM event binding + config setters.
 *
 * Exports bindControls(actions) which receives core action functions from
 * main.js (breaking the circular dep). Self-contained setters (color limit,
 * axis mode, geometry, …) are defined and exported here, then re-exposed on
 * window by main.js for Wallpaper Engine / legacy compatibility.
 */

import { AppState }                  from './appState.js';
import { LATENT_DIM }                from './constants.js';
import { clamp }                     from './math.js';
import { drawArt, getCanvas }        from './renderer.js';
import { saveState }                 from './state.js';
import { setActiveRendererName, listRenderers, getRenderer } from './renderers/registry.js';
import { setActivePaletteName, listPalettes, getPalette }    from './palettes/registry.js';
import {
    syncControlUI, updatePaletteUI, setPausedVisual,
    setStudioView, toggleLanguage, enableManualPalette,
    clearManualPalette, applyLanguage, initPaletteSwatches, rebuildPaletteSwatches,
    updateText, updateMatrixUI,
} from './ui.js';
import { setWallpaperDisplayMode, setWallpaperRandomMode, applyWallpaperDisplay, setWallpaperMode, setFrostedBlur, setGrowthSteps, setGrowthOvershoot, setWipeCell, setWipeOrder } from './wallpaper.js';
import { latentProjector, latentMapViewport, projectLatentTo2D }                  from './latentMap.js';
import { exportMainCanvas, toggleSequenceRecording, exportUniverseBatchZip }      from './export.js';

// ── Config setters (also exposed as window globals) ───────────────────────

export function setColorLimit(value) {
    AppState.colorLimit = clamp(Math.floor(Number(value) || 0), 0, 32);
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

export function setRandomness(value) {
    AppState.randomnessLevel = clamp((Number(value) || 0) / 100, 0, 1);
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

export function setAxisMode(mode) {
    if (!['both', 'x', 'y'].includes(mode)) return;
    AppState.axisMode = mode;
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

export function setGeometryMode(name) {
    if (!listRenderers().includes(name)) return;
    setActiveRendererName(name);
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

export function setLayerMode(mode) {
    if (!['auto', 'xTop', 'yTop'].includes(mode)) return;
    AppState.layerMode = mode;
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

export function setActivationMode(mode) {
    if (!['relu', 'leaky', 'tanh', 'swish'].includes(mode)) return;
    AppState.activationMode = mode;
    AppState.previousDecoderState = null;
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

export function setPalette(name) {
    if (!listPalettes().includes(name)) return;
    setActivePaletteName(name);
    rebuildPaletteSwatches(handleSwatchClick);
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

// ── Palette swatch handler (module-level so theme switching can rebuild) ──

export function handleSwatchClick(idx) {
    const set = new Set(AppState.manualPaletteIndices);
    if (set.has(idx)) set.delete(idx); else set.add(idx);
    AppState.manualPaletteIndices = [...set].sort((a, b) => a - b);
    updatePaletteUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

// ── Dynamic slot builders ─────────────────────────────────────────────────

function buildRendererSlots(onRendererChange) {
    const slot = document.getElementById('renderer-slot');
    if (!slot) return;
    slot.innerHTML = '';
    for (const name of listRenderers()) {
        const btn = document.createElement('button');
        btn.type            = 'button';
        btn.className       = 'action-btn';
        btn.dataset.renderer = name;
        btn.textContent     = getRenderer(name).label;
        btn.addEventListener('click', () => onRendererChange(name));
        slot.appendChild(btn);
    }
}

function buildPaletteThemeSlots(onPaletteChange) {
    const slot = document.getElementById('palette-theme-slot');
    if (!slot) return;
    slot.innerHTML = '';
    for (const name of listPalettes()) {
        const btn = document.createElement('button');
        btn.type           = 'button';
        btn.className      = 'action-btn';
        btn.dataset.palette = name;
        btn.textContent    = getPalette(name).label;
        btn.addEventListener('click', () => onPaletteChange(name));
        slot.appendChild(btn);
    }
}

// ── Latent map click-to-jump ──────────────────────────────────────────────

function jumpToLatentMap(event) {
    if (!AppState.currentEntity || !latentProjector.x || !latentProjector.y) return;
    const canvas = event.currentTarget;
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top)  * scaleY;
    const scale   = latentMapViewport.scale || 1;
    const targetX = (x - canvas.width  / 2) / scale;
    const targetY = (canvas.height / 2 - y) / scale;
    const current = projectLatentTo2D(AppState.currentEntity.z);
    const dx = clamp(targetX - current.x, -3, 3);
    const dy = clamp(targetY - current.y, -3, 3);

    for (let i = 0; i < LATENT_DIM; i++) {
        AppState.currentEntity.z[i]       += latentProjector.x[i] * dx + latentProjector.y[i] * dy;
        AppState.currentEntity.velocity[i] *= 0.25;
    }

    AppState.generationCount++;
    drawArt(getCanvas(), AppState.currentEntity);
    updateText('gen-counter', AppState.generationCount);
    updateMatrixUI(AppState.currentEntity);
    saveState();
}

// ── Switch-seconds step: 0.1 s below 1 s, 1 s at/above 1 s ────────────────

function updateSwitchStep(input) {
    if (!input) return;
    const v = Number(input.value);
    input.step = (Number.isFinite(v) && v < 1) ? '0.1' : '1';
}

// ── Main binding function ─────────────────────────────────────────────────

/**
 * @param {{ togglePause, hardReset, jumpLatentRegion, startAnimation, nextWallpaper }} actions
 */
export function bindControls(actions) {
    const { togglePause, hardReset, jumpLatentRegion, nextWallpaper } = actions;
    const canvas = getCanvas();

    // ── Dynamic slots (registry-driven) ───────────────────────────────
    buildRendererSlots(name => setGeometryMode(name));
    buildPaletteThemeSlots(name => setPalette(name));

    // ── Palette swatches ──────────────────────────────────────────────
    initPaletteSwatches(handleSwatchClick);

    // ── Settings panel ────────────────────────────────────────────────
    const settingsBtn   = document.getElementById('settings-btn');
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsBtn && settingsPanel) settingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('open'));

    const nextBtn = document.getElementById('next-btn');
    if (nextBtn) {
        nextBtn.setAttribute('aria-label', 'Next');
        nextBtn.textContent = String.fromCodePoint(0x23ED);
        nextBtn.addEventListener('click', nextWallpaper);
    }

    const studioBtn = document.getElementById('studio-btn');
    if (studioBtn) studioBtn.addEventListener('click', () => setStudioView(!document.body.classList.contains('studio-view')));

    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn && settingsPanel) {
        resetBtn.textContent = '重启宇宙';
        settingsPanel.appendChild(resetBtn);
    }

    // ── Wallpaper modes ───────────────────────────────────────────────
    document.getElementById('growth-mode-btn')?.addEventListener('click',   () => setWallpaperRandomMode('growth'));
    document.getElementById('universe-mode-btn')?.addEventListener('click', () => setWallpaperRandomMode('universe'));
    document.getElementById('wipe-mode-btn')?.addEventListener('click',     () => setWallpaperRandomMode('wipe'));
    document.getElementById('dim-mode-btn')?.addEventListener('click',      () => setWallpaperRandomMode('dim'));
    document.getElementById('wipe-cell-4')?.addEventListener('click',   () => setWipeCell(4));
    document.getElementById('wipe-cell-8')?.addEventListener('click',   () => setWipeCell(8));
    document.getElementById('wipe-cell-16')?.addEventListener('click',  () => setWipeCell(16));
    document.getElementById('wipe-cell-32')?.addEventListener('click',  () => setWipeCell(32));
    document.getElementById('wipe-cell-64')?.addEventListener('click',  () => setWipeCell(64));
    document.getElementById('wipe-order-ordered')?.addEventListener('click', () => setWipeOrder('ordered'));
    document.getElementById('wipe-order-random')?.addEventListener('click',  () => setWipeOrder('random'));
    document.getElementById('fill-mode-btn')?.addEventListener('click',   () => setWallpaperDisplayMode('fill'));
    document.getElementById('square-mode-btn')?.addEventListener('click', () => setWallpaperDisplayMode('square'));
    document.getElementById('outer-color')?.addEventListener('input', event => {
        AppState.wallpaperOuterColor = event.target.value;
        applyWallpaperDisplay(false);
        saveState();
    });
    document.getElementById('mode-normal-btn')?.addEventListener('click',  () => setWallpaperMode('normal'));
    document.getElementById('mode-frosted-btn')?.addEventListener('click', () => setWallpaperMode('frosted'));
    document.getElementById('frosted-blur')?.addEventListener('input', event => setFrostedBlur(event.target.value));
    document.getElementById('growth-steps')?.addEventListener('change',  event => setGrowthSteps(event.target.value));
    document.getElementById('growth-overshoot')?.addEventListener('input', event => setGrowthOvershoot(event.target.value));
    document.getElementById('switch-seconds')?.addEventListener('input', event => {
        updateSwitchStep(event.target);
    });
    document.getElementById('switch-seconds')?.addEventListener('change', event => {
        AppState.wallpaperSwitchSeconds = clamp(Math.round((Number(event.target.value) || 60) * 10) / 10, 0.1, 3600);
        event.target.value = AppState.wallpaperSwitchSeconds;
        updateSwitchStep(event.target);
        AppState.lastWallpaperSwitch = performance.now();
        saveState();
    });

    // ── Playback ──────────────────────────────────────────────────────
    document.getElementById('pause-btn')?.addEventListener('click', togglePause);
    if (resetBtn) resetBtn.addEventListener('click', hardReset);
    document.getElementById('jump-btn')?.addEventListener('click', jumpLatentRegion);
    document.getElementById('save-btn')?.addEventListener('click', exportMainCanvas);
    document.getElementById('record-btn')?.addEventListener('click', toggleSequenceRecording);
    document.getElementById('universe-batch-btn')?.addEventListener('click', exportUniverseBatchZip);
    document.getElementById('lang-btn')?.addEventListener('click', toggleLanguage);

    // ── Range inputs ──────────────────────────────────────────────────
    document.getElementById('color-count')?.addEventListener('input', event => setColorLimit(event.target.value));
    document.getElementById('randomness')?.addEventListener('input', event => setRandomness(event.target.value));

    // ── Legacy geometry / layer / activation / axis buttons ──────────
    document.getElementById('form-linear-btn')?.addEventListener('click', () => setGeometryMode('linear'));
    document.getElementById('form-radial-btn')?.addEventListener('click', () => setGeometryMode('radial'));
    document.getElementById('layer-auto-btn')?.addEventListener('click', () => setLayerMode('auto'));
    document.getElementById('layer-x-btn')?.addEventListener('click',    () => setLayerMode('xTop'));
    document.getElementById('layer-y-btn')?.addEventListener('click',    () => setLayerMode('yTop'));
    document.getElementById('act-relu-btn')?.addEventListener('click',   () => setActivationMode('relu'));
    document.getElementById('act-leaky-btn')?.addEventListener('click',  () => setActivationMode('leaky'));
    document.getElementById('act-tanh-btn')?.addEventListener('click',   () => setActivationMode('tanh'));
    document.getElementById('act-swish-btn')?.addEventListener('click',  () => setActivationMode('swish'));
    document.getElementById('axis-both-btn')?.addEventListener('click',  () => setAxisMode('both'));
    document.getElementById('axis-x-btn')?.addEventListener('click',     () => setAxisMode('x'));
    document.getElementById('axis-y-btn')?.addEventListener('click',     () => setAxisMode('y'));

    // ── Palette auto/manual ───────────────────────────────────────────
    document.getElementById('palette-auto-btn')?.addEventListener('click', clearManualPalette);
    document.getElementById('palette-manual-btn')?.addEventListener('click', enableManualPalette);

    // ── Latent map click-to-jump ──────────────────────────────────────
    document.getElementById('latent-map-canvas')?.addEventListener('click', jumpToLatentMap);

    // ── Move panels into settings slots ───────────────────────────────
    const axisSlot = document.getElementById('wallpaper-axis-slot');
    const axisControls = document.querySelector('.axis-controls');
    if (axisSlot && axisControls) axisSlot.appendChild(axisControls);
    const colorSlot = document.getElementById('wallpaper-color-slot');
    const colorPanel = document.querySelector('.palette-panel');
    if (colorSlot && colorPanel) colorSlot.appendChild(colorPanel);
    const colorRow = document.getElementById('color-label');
    if (colorSlot && colorRow) colorSlot.appendChild(colorRow);

    // ── Keyboard shortcuts ────────────────────────────────────────────
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT') return;
        switch (e.key) {
            case ' ':   e.preventDefault(); togglePause(); break;
            case 'n': case 'ArrowRight': document.getElementById('next-btn')?.click(); break;
            case 'r':   hardReset();    break;
            case 'j':   jumpLatentRegion(); break;
            case 's':   exportMainCanvas(); break;
        }
    });

    // ── Window resize ─────────────────────────────────────────────────
    window.addEventListener('resize', () => applyWallpaperDisplay());

    // ── Wallpaper Engine property listener ───────────────────────────
    if (window.wallpaperPropertyListener === undefined) {
        window.wallpaperPropertyListener = {
            applyUserProperties(properties) {
                if (properties.randommode)    setWallpaperRandomMode(['growth', 'universe', 'wipe', 'dim'][properties.randommode.value] || 'growth');
                if (properties.displaymode)   setWallpaperDisplayMode(properties.displaymode.value === 1 ? 'square' : 'fill');
                if (properties.wallpapermode) setWallpaperMode(properties.wallpapermode.value === 1 ? 'frosted' : 'normal');
                if (properties.frostedblur)   setFrostedBlur(properties.frostedblur.value);
                if (properties.growthsteps)     setGrowthSteps(properties.growthsteps.value);
                if (properties.growthovershoot) setGrowthOvershoot(properties.growthovershoot.value);
                if (properties.wipecell)        setWipeCell([4, 8, 16, 32, 64][properties.wipecell.value]);
                if (properties.wipeorder)       setWipeOrder(properties.wipeorder.value === 1 ? 'random' : 'ordered');
                if (properties.switchseconds) {
                    AppState.wallpaperSwitchSeconds = clamp(Math.round((Number(properties.switchseconds.value) || 60) * 10) / 10, 0.1, 3600);
                    const el = document.getElementById('switch-seconds');
                    if (el) { el.value = String(AppState.wallpaperSwitchSeconds); updateSwitchStep(el); }
                }
                if (properties.axis) setAxisMode(['both', 'x', 'y'][properties.axis.value] || 'both');
                if (properties.outercolor) {
                    AppState.wallpaperOuterColor = properties.outercolor.value;
                    applyWallpaperDisplay(false);
                }
            },
        };
    }

    // ── Initial UI sync ───────────────────────────────────────────────
    const switchEl = document.getElementById('switch-seconds');
    if (switchEl) { switchEl.value = String(AppState.wallpaperSwitchSeconds); updateSwitchStep(switchEl); }
    const outerEl = document.getElementById('outer-color');
    if (outerEl) outerEl.value = AppState.wallpaperOuterColor;

    syncControlUI();
    applyLanguage();
}
