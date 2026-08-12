/**
 * ui.js — DOM synchronisation, i18n, palette/renderer UI helpers.
 *
 * Imports renderer.js for drawArt (used in setStudioView).
 * Does NOT create circular deps: renderer.js does NOT import ui.js.
 */

import { AppState }                  from './appState.js';
import { LATENT_DIM }                from './constants.js';
import { clamp }                     from './math.js';
import { getActiveRendererName, getRenderer } from './renderers/registry.js';
import { getActivePaletteName, getActivePalette } from './palettes/registry.js';
import { getLayerLabel }             from './renderers/sort.js';
import { getActivationLabel }        from './decoder.js';
import { drawArt, getCanvas }        from './renderer.js';
import { saveState }                 from './state.js';

// ── DOM helper ────────────────────────────────────────────────────────────

export function updateText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

// ── i18n ─────────────────────────────────────────────────────────────────

const UI_TEXT = {
    en: {
        pause: 'PAUSE', resume: 'RESUME', reset: 'REBOOT UNIVERSE',
        jump: 'LATENT JUMP',
        save: 'SAVE PNG', language: '中文', colors: 'COLORS',
        random: 'RANDOM', palette: 'PALETTE', auto: 'AUTO',
        latentMap: 'LATENT MAP', decoderView: 'DECODER VIEW',
    },
    zh: {
        pause: '暂停', resume: '继续', reset: '重启宇宙',
        jump: '隐空间跳跃',
        save: '保存 PNG', language: 'EN', colors: '颜色',
        random: '随机', palette: '色板', auto: '自动',
        latentMap: '隐空间图', decoderView: '解码器视图',
    },
};

export const t = key => UI_TEXT[AppState.currentLanguage]?.[key] ?? UI_TEXT.en[key] ?? key;

export function applyLanguage() {
    updateText('reset-btn',         t('reset'));
    const wallpaperResetButton = document.getElementById('reset-btn');
    if (wallpaperResetButton && wallpaperResetButton.parentElement?.id === 'settings-panel') wallpaperResetButton.innerText = '重启宇宙';
    updateText('jump-btn',          t('jump'));
    updateText('save-btn',          t('save'));
    updateText('record-btn',        'RECORD ZIP');
    updateText('universe-batch-btn','100 UNIVERSES');
    updateText('lang-btn',          t('language'));
    updateText('palette-label',     t('palette'));
    updateText('palette-auto-btn',  t('auto'));

    const labels = {
        'frames-label':   'FRAMES ',
        'interval-label': 'EVERY ',
        'size-label':     'SIZE ',
        'color-label':    `${t('colors')} `,
        'random-label':   `${t('random')} `,
    };
    for (const [id, text] of Object.entries(labels)) {
        const el = document.getElementById(id);
        if (el && el.firstChild) el.firstChild.nodeValue = text;
    }

    const titles = document.querySelectorAll('.viz-title');
    if (titles[0]) titles[0].innerText = t('latentMap');
    if (titles[1]) titles[1].innerText = t('decoderView');

    setPausedVisual(AppState.isPaused);
    syncControlUI();
}

export function toggleLanguage() {
    AppState.currentLanguage = AppState.currentLanguage === 'en' ? 'zh' : 'en';
    applyLanguage();
    saveState();
}

// ── Pause / play visual ───────────────────────────────────────────────────

export function setPausedVisual(paused) {
    const btn       = document.getElementById('pause-btn');
    const indicator = document.querySelector('.status-indicator');
    if (btn) {
        const isStudio = document.body.classList.contains('studio-view');
        btn.textContent = isStudio
            ? (paused ? 'RESUME' : 'PAUSE')
            : String.fromCodePoint(paused ? 0x25B6 : 0x23F8);
        btn.setAttribute('aria-label', isStudio ? (paused ? 'RESUME' : 'PAUSE') : (paused ? '继续播放' : '暂停'));
    }
    if (paused) {
        if (btn) { btn.style.color = '#ef4444'; btn.style.borderColor = '#ef4444'; }
        if (indicator) { indicator.style.backgroundColor = '#ef4444'; indicator.style.boxShadow = '0 0 10px #ef4444'; }
    } else {
        if (btn) { btn.style.color = '#d1d5db'; btn.style.borderColor = 'rgba(255, 255, 255, 0.2)'; }
        if (indicator) { indicator.style.backgroundColor = '#10b981'; indicator.style.boxShadow = '0 0 10px #10b981'; }
    }
}

// ── Studio view toggle ────────────────────────────────────────────────────

export function setStudioView(enabled, shouldSave = true) {
    document.body.classList.toggle('studio-view', enabled);
    const studioButton = document.getElementById('studio-btn');
    const settingsPanel = document.getElementById('settings-panel');
    const controls      = document.querySelector('.controls');
    const resetButton   = document.getElementById('reset-btn');
    const pauseButton   = document.getElementById('pause-btn');
    const colorSlot     = document.getElementById('wallpaper-color-slot');
    const colorPanel    = document.querySelector('.palette-panel');
    const colorRow      = document.getElementById('color-label');

    if (studioButton) {
        studioButton.setAttribute('aria-label', enabled ? '返回壁纸' : '原版工作台');
        studioButton.textContent = enabled ? 'BACK' : '★';
    }
    if (settingsPanel) settingsPanel.classList.remove('open');

    if (enabled && controls && resetButton && pauseButton) {
        controls.insertBefore(resetButton, pauseButton);
        resetButton.innerText = 'REBOOT UNIVERSE';
        if (colorPanel) controls.appendChild(colorPanel);
        if (colorRow)   controls.appendChild(colorRow);
        pauseButton.innerText = AppState.isPaused ? 'RESUME' : 'PAUSE';
        pauseButton.setAttribute('aria-label', AppState.isPaused ? 'RESUME' : 'PAUSE');
    } else if (!enabled && settingsPanel && resetButton) {
        settingsPanel.appendChild(resetButton);
        resetButton.innerText = '重启宇宙';
        if (colorSlot && colorPanel) colorSlot.appendChild(colorPanel);
        if (colorSlot && colorRow)   colorSlot.appendChild(colorRow);
        setPausedVisual(AppState.isPaused);
    }

    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    if (shouldSave) saveState();
}

// ── Matrix UI (latent cell grid) ──────────────────────────────────────────

export function initMatrixUI() {
    const container = document.getElementById('matrix-container');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < LATENT_DIM; i++) {
        const cell = document.createElement('div');
        cell.className = 'latent-cell';
        cell.id        = `cell-${i}`;
        container.appendChild(cell);
    }
}

export function updateMatrixUI(entity) {
    if (!entity) return;
    for (let i = 0; i < LATENT_DIM; i++) {
        const cell = document.getElementById(`cell-${i}`);
        if (!cell) continue;
        const val        = entity.z[i];
        const normalized = clamp((val + 5.5) / 11, 0, 1);
        if (val > 1)       cell.style.backgroundColor = `rgba(16,185,129,${normalized})`;
        else if (val < -1) cell.style.backgroundColor = `rgba(239,68,68,${1 - normalized})`;
        else               cell.style.backgroundColor = `rgba(255,255,255,${normalized * 0.22})`;
    }
}

// ── Palette swatch UI ─────────────────────────────────────────────────────

export function initPaletteSwatches(onSwatchClick) {
    const container = document.getElementById('palette-swatches');
    if (!container) return;
    _rebuildSwatches(container, onSwatchClick);
}

export function rebuildPaletteSwatches(onSwatchClick) {
    initPaletteSwatches(onSwatchClick);
}

function _rebuildSwatches(container, onSwatchClick) {
    container.innerHTML = '';
    getActivePalette().colors.forEach((color, idx) => {
        const btn = document.createElement('button');
        btn.type             = 'button';
        btn.className        = 'palette-swatch';
        btn.style.backgroundColor = color;
        btn.title            = `${idx + 1}: ${color}`;
        btn.dataset.index    = String(idx);
        btn.addEventListener('click', () => onSwatchClick(idx));
        container.appendChild(btn);
    });
    updatePaletteUI();
}

export function updatePaletteUI() {
    const container = document.getElementById('palette-swatches');
    if (!container) return;
    const selected  = new Set(AppState.manualPaletteIndices);
    const active    = new Set(AppState.lastActivePaletteIndices);
    const hasManual = AppState.manualPaletteIndices.length > 0;
    for (const swatch of container.querySelectorAll('.palette-swatch')) {
        const idx = Number(swatch.dataset.index);
        swatch.classList.toggle('manual', selected.has(idx));
        swatch.classList.toggle('active', hasManual ? selected.has(idx) : active.has(idx));
    }
    document.getElementById('palette-auto-btn')?.classList.toggle('active', !hasManual);
    document.getElementById('palette-manual-btn')?.classList.toggle('active', hasManual);
}

// ── Manual palette actions ────────────────────────────────────────────────

export function enableManualPalette() {
    if (AppState.manualPaletteIndices.length === 0) {
        AppState.manualPaletteIndices = AppState.lastActivePaletteIndices.length
            ? AppState.lastActivePaletteIndices.slice()
            : [0, 6, 12, 18];
    }
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

export function clearManualPalette() {
    AppState.manualPaletteIndices = [];
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
}

// ── Control sync ──────────────────────────────────────────────────────────

export function syncControlUI() {
    // Range / number inputs
    const colorInput = document.getElementById('color-count');
    if (colorInput) colorInput.value = String(AppState.colorLimit);
    const randomInput = document.getElementById('randomness');
    const randomValue = Math.round(AppState.randomnessLevel * 100);
    if (randomInput) randomInput.value = String(randomValue);
    updateText('color-count-value', AppState.colorLimit === 0 ? 'AUTO' : AppState.colorLimit);
    updateText('param-color-limit', AppState.colorLimit === 0 ? 'AUTO' : AppState.colorLimit);
    updateText('randomness-value',  randomValue);
    updateText('param-random',      AppState.randomnessLevel.toFixed(2));

    // Param overlay
    const rendererName = getActiveRendererName();
    const isRadial     = rendererName === 'radial';
    updateText('param-form',       getRenderer(rendererName)?.label ?? '—');
    updateText('param-layer',      getLayerLabel(AppState.layerMode, isRadial));
    updateText('param-activation', getActivationLabel(AppState.activationMode));
    updateText('param-axis',       AppState.axisMode === 'both' ? 'XY' : AppState.axisMode.toUpperCase());
    updatePaletteUI();

    _syncButtonGroup({ 'form-linear-btn': 'linear', 'form-radial-btn': 'radial' }, rendererName);
    _syncButtonGroup({ 'layer-auto-btn': 'auto', 'layer-x-btn': 'xTop', 'layer-y-btn': 'yTop' }, AppState.layerMode);
    _syncButtonGroup({ 'act-relu-btn': 'relu', 'act-leaky-btn': 'leaky', 'act-tanh-btn': 'tanh', 'act-swish-btn': 'swish' }, AppState.activationMode);
    _syncButtonGroup({ 'axis-both-btn': 'both', 'axis-x-btn': 'x', 'axis-y-btn': 'y' }, AppState.axisMode);

    // Layer mode labels adapt to renderer
    updateText('layer-x-btn', isRadial ? 'SECTOR TOP' : 'VERT TOP');
    updateText('layer-y-btn', isRadial ? 'RING TOP'   : 'HORIZ TOP');

    _syncRendererSlots(rendererName);
    _syncPaletteThemeSlots();
    updatePaletteUI();

    // Wallpaper-mode buttons
    const frosted = AppState.wallpaperMode === 'frosted';
    document.getElementById('fill-mode-btn')?.classList.toggle('active',     frosted || AppState.wallpaperDisplayMode === 'fill');
    document.getElementById('square-mode-btn')?.classList.toggle('active',   !frosted && AppState.wallpaperDisplayMode === 'square');
    document.getElementById('mode-normal-btn')?.classList.toggle('active',   !frosted);
    document.getElementById('mode-frosted-btn')?.classList.toggle('active',  frosted);
    document.getElementById('growth-mode-btn')?.classList.toggle('active',   AppState.wallpaperRandomMode === 'growth');
    document.getElementById('universe-mode-btn')?.classList.toggle('active', AppState.wallpaperRandomMode === 'universe');
    document.getElementById('wipe-mode-btn')?.classList.toggle('active',     AppState.wallpaperRandomMode === 'wipe');
    document.getElementById('dim-mode-btn')?.classList.toggle('active',      AppState.wallpaperRandomMode === 'dim');

    // Growth-mode params (hidden when the mode doesn't use them)
    const gSteps = document.getElementById('growth-steps');
    if (gSteps) gSteps.value = String(AppState.growthSteps);
    const gOs = document.getElementById('growth-overshoot');
    if (gOs) gOs.value = String(AppState.growthOvershoot);
    updateText('growth-overshoot-value', `${AppState.growthOvershoot}%`);

    // Wipe cell-size + reveal-order buttons
    _syncButtonGroup({ 'wipe-cell-4': 4, 'wipe-cell-8': 8, 'wipe-cell-16': 16, 'wipe-cell-32': 32, 'wipe-cell-64': 64 }, AppState.wipeCell);
    _syncButtonGroup({ 'wipe-order-ordered': 'ordered', 'wipe-order-random': 'random' }, AppState.wipeOrder);

    _applySettingsVisibility();
}

// ── Settings visibility: hide options the current mode doesn't support ────
function _applySettingsVisibility() {
    const isFrosted = AppState.wallpaperMode === 'frosted';
    document.getElementById('frosted-blur-row')?.classList.toggle('hidden', !isFrosted);
    document.getElementById('display-controls')?.classList.toggle('hidden', isFrosted);

    const rm = AppState.wallpaperRandomMode;
    const showGrowth = rm === 'growth';
    document.getElementById('growth-controls')?.classList.toggle('hidden', !showGrowth);
    document.getElementById('growth-overshoot-row')?.classList.toggle('hidden', rm !== 'growth');
    document.getElementById('wipe-controls')?.classList.toggle('hidden', rm !== 'wipe');
}

function _syncButtonGroup(idToValueMap, activeValue) {
    for (const [id, val] of Object.entries(idToValueMap)) {
        document.getElementById(id)?.classList.toggle('active', val === activeValue);
    }
}

function _syncRendererSlots(activeRendererName) {
    const slot = document.getElementById('renderer-slot');
    if (!slot) return;
    for (const btn of slot.querySelectorAll('[data-renderer]')) {
        btn.classList.toggle('active', btn.dataset.renderer === activeRendererName);
    }
}

function _syncPaletteThemeSlots() {
    const currentPalette = getActivePaletteName();
    const slot = document.getElementById('palette-theme-slot');
    if (!slot) return;
    for (const btn of slot.querySelectorAll('[data-palette]')) {
        btn.classList.toggle('active', btn.dataset.palette === currentPalette);
    }
}
