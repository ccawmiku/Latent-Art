/**
 * renderer.js — drawArt() orchestrator.
 *
 * Decodes latent params, builds the samplers / colour pickers, assembles the
 * RenderContext object, and delegates the actual drawing to the active
 * renderer. Does NOT import ui.js (avoids circular dep); tiny DOM helpers are
 * inlined below.
 */

import { AppState }              from './appState.js';
import { getActiveRenderer, getActiveRendererName } from './renderers/registry.js';
import { getActivePalette }      from './palettes/registry.js';
import { createStableSampler, createColorPicker } from './colorPicker.js';
import { projectLatentTo2D, pushLatentTrail, drawLatentMap, drawDecoderView } from './latentMap.js';
import { getLayerLabel }         from './renderers/sort.js';
import { getActivationLabel }    from './decoder.js';

// ── Tiny DOM helper (avoid importing ui.js → no circular dep) ─────────────
function updateText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

// ── Palette swatch highlight (inlined to avoid circular dep with ui.js) ───
function syncPaletteSwatchHighlight() {
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

// ── Main draw function ────────────────────────────────────────────────────

/**
 * Draw a complete frame to canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {import('./entity.js').LatentEntity} entity
 * @param {{ updatePanels?: boolean, generationCount?: number }} [options]
 */
export function drawArt(canvas, entity, options = {}) {
    if (!canvas || !entity || !AppState.universeDecoder) return;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const w              = canvas.width;
    const h              = canvas.height;
    const updatePanels   = options.updatePanels !== false;
    const renderGen      = Number.isFinite(options.generationCount)
        ? options.generationCount : AppState.generationCount;

    // ── Decode params ─────────────────────────────────────────────────
    const params = entity.getPhysicalParams(
        AppState.universeDecoder,
        AppState.activationMode,
        { colorLimit: AppState.colorLimit, manualPaletteIndices: AppState.manualPaletteIndices }
    );

    if (updatePanels) {
        AppState.lastParams                  = params;
        AppState.lastForwardState            = params._forwardState;
        AppState.lastActivePaletteIndices    = params.paletteIndices.slice();
        syncPaletteSwatchHighlight();

        const pt = projectLatentTo2D(entity.z);
        AppState.lastLatentSpeed = pushLatentTrail(pt);
        drawLatentMap(document.getElementById('latent-map-canvas'), pt);
        AppState.previousDecoderState = drawDecoderView(
            document.getElementById('decoder-canvas'),
            AppState.lastForwardState,
            AppState.previousDecoderState
        );
    }

    // ── Colour pickers + samplers ─────────────────────────────────────
    const paletteColors = getActivePalette().colors;
    const vSampler      = createStableSampler('vertical',   params, renderGen, AppState.universeSeed, AppState.randomnessLevel);
    const hSampler      = createStableSampler('horizontal', params, renderGen, AppState.universeSeed, AppState.randomnessLevel);
    const vPickColor    = createColorPicker(paletteColors, params.paletteIndices, params.energies, params.vPaletteBias, params.accentBias, s => vSampler(`palette:${s}`));
    const hPickColor    = createColorPicker(paletteColors, params.paletteIndices, params.energies, params.hPaletteBias, params.accentBias, s => hSampler(`palette:${s}`));

    // ── Render ────────────────────────────────────────────────────────
    const renderer = getActiveRenderer();
    renderer.render(ctx, {
        params,
        axisMode:      AppState.axisMode,
        layerMode:     AppState.layerMode,
        vSampler,
        hSampler,
        vPickColor,
        hPickColor,
        paletteColors,
    });

    // ── Param overlay ─────────────────────────────────────────────────
    if (updatePanels) {
        const isRadial = getActiveRendererName() === 'radial';
        updateText('param-colors',     params.paletteIndices.length);
        updateText('param-step',       params.stepMod.toFixed(3));
        updateText('param-vdens',      params.vDensity.toFixed(3));
        updateText('param-hdens',      params.hDensity.toFixed(3));
        updateText('param-vskip',      params.vSkipRate.toFixed(2));
        updateText('param-hskip',      params.hSkipRate.toFixed(2));
        updateText('param-z',          params.zSpread.toFixed(2));
        updateText('param-random',     AppState.randomnessLevel.toFixed(2));
        updateText('param-form',       renderer.label);
        updateText('param-layer',      getLayerLabel(AppState.layerMode, isRadial));
        updateText('param-activation', getActivationLabel(AppState.activationMode));
        updateText('param-axis',       AppState.axisMode === 'both' ? 'XY' : AppState.axisMode.toUpperCase());
        updateText('param-speed',      AppState.lastLatentSpeed.toFixed(2));
    }
}

/** Convenience: get the main wallpaper canvas element. */
export function getCanvas() {
    return document.getElementById('main-canvas');
}
