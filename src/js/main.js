/**
 * main.js — Application entry point.
 *
 * Responsibilities:
 *  1. Register all renderers and palettes (via their barrels)
 *  2. bootstrap() — restore or create fresh state, bind controls, draw once
 *  3. loop() — switch-timer driven rAF loop (idle between switches)
 *  4. Expose window globals for Wallpaper Engine and legacy compatibility
 *  5. Run self-tests in development
 */

// ── Register renderers + palettes (side-effect imports) ──────────────────
import './renderers/index.js';
import './palettes/index.js';

// ── Core imports ──────────────────────────────────────────────────────────
import { AppState, randomizeRuntimeControls } from './appState.js';
import { LATENT_DIM, HIDDEN_1, HIDDEN_2, OUT_DIM, TAU, FPS_LIMIT, FRAME_DELAY } from './constants.js';
import { createUniverseSeed, assert } from './math.js';
import { DecoderNetwork } from './decoder.js';
import { LatentEntity }   from './entity.js';
import { drawArt, getCanvas } from './renderer.js';
import { setActiveRendererName } from './renderers/registry.js';
import { setActivePaletteName }  from './palettes/registry.js';
import { restoreSavedState, saveState, maybePersistState, serializeDecoder, restoreDecoder, serializeEntity, restoreEntity } from './state.js';
import { initLatentProjector, latentTrail, projectLatentTo2D, latentProjector } from './latentMap.js';
import {
    setPausedVisual, syncControlUI,
    updateText, applyLanguage, initMatrixUI, updateMatrixUI, clearManualPalette,
} from './ui.js';
import { applyWallpaperDisplay, nextWallpaper, setWallpaperRandomMode, advanceWallpaper, setWallpaperMode, setFrostedBlur, setGrowthSteps, setGrowthOvershoot } from './wallpaper.js';
import { setColorLimit, setRandomness, setAxisMode, setGeometryMode, setLayerMode, setActivationMode, setPalette, bindControls } from './controls.js';
import { captureSequenceFrame, toggleSequenceRecording, exportUniverseBatchZip, exportMainCanvas, updateRecordButton } from './export.js';
import { generateStripes }  from './renderers/linear.js';
import { generateRadialSegments } from './renderers/radial.js';
import { classicPalette }   from './palettes/classic.js';
import { applyLiquidGlass } from './liquidGlass.js';

// ── Bootstrap ─────────────────────────────────────────────────────────────

function freshUniverse() {
    AppState.universeSeed          = createUniverseSeed();
    AppState.universeDecoder       = new DecoderNetwork();
    AppState.currentEntity         = new LatentEntity();
    AppState.generationCount       = 0;
    AppState.colorLimit            = 0;
    AppState.axisMode              = 'both';
    AppState.layerMode             = 'auto';
    AppState.activationMode        = 'relu';
    AppState.currentLanguage       = 'en';
    AppState.wallpaperRandomMode   = 'growth';
    AppState.wallpaperDisplayMode  = 'square';
    AppState.wallpaperMode         = 'normal';
    AppState.frostedBlur           = 16;
    AppState.wallpaperSwitchSeconds = 1;
    AppState.wallpaperOuterColor   = '#ffffff';
    AppState.growthSteps           = 30;
    AppState.growthOvershoot       = 65;
    AppState.growthStart           = null;
    AppState.growthDelta           = null;
    AppState.growthStepCount       = 0;
    AppState.wipeTarget            = null;
    AppState.wipeCanvas            = null;
    AppState.wipeStepCount         = 0;
    AppState.dimTarget             = null;
    AppState.dimIndex              = 0;
    AppState.manualPaletteIndices  = [];
    randomizeRuntimeControls();
    setActiveRendererName('linear');
    setActivePaletteName('classic');
}

function bootstrap() {
    if (AppState.hasBootstrapped) return;
    AppState.hasBootstrapped = true;

    initMatrixUI();
    initLatentProjector();

    if (!restoreSavedState()) freshUniverse();

    AppState.lastParams           = null;
    AppState.lastForwardState     = null;
    AppState.previousDecoderState = null;
    AppState.isPaused             = false;

    bindControls({ togglePause, hardReset, jumpLatentRegion, nextWallpaper });

    const secondsInput = document.getElementById('switch-seconds');
    if (secondsInput) secondsInput.value = String(AppState.wallpaperSwitchSeconds);
    const outerColorInput = document.getElementById('outer-color');
    if (outerColorInput) outerColorInput.value = AppState.wallpaperOuterColor;

    setWallpaperRandomMode(AppState.wallpaperRandomMode);
    applyWallpaperDisplay(false);
    setPausedVisual(false);
    applyLanguage();
    syncControlUI();
    updateText('gen-counter', AppState.generationCount);
    updateMatrixUI(AppState.currentEntity);
    drawArt(getCanvas(), AppState.currentEntity);
    runSelfTests();
    applyLiquidGlass();

    startAnimation();
}

// ── Animation loop (switch-timer driven, idle between switches) ──────────

function loop(timestamp) {
    if (AppState.isPaused) return;

    if (!AppState.currentEntity || !AppState.universeDecoder) {
        AppState.animationId = requestAnimationFrame(loop);
        return;
    }

    if (!AppState.lastWallpaperSwitch) AppState.lastWallpaperSwitch = timestamp;

    if (timestamp - AppState.lastWallpaperSwitch >= AppState.wallpaperSwitchSeconds * 1000) {
        AppState.lastWallpaperSwitch = timestamp;
        advanceWallpaper();
        // Wipe mode draws its own stripe; a redraw would erase it.
        if (AppState.wallpaperRandomMode !== 'wipe') drawArt(getCanvas(), AppState.currentEntity);
        captureSequenceFrame(AppState.currentEntity, AppState.generationCount);
        updateText('gen-counter', AppState.generationCount);
        updateMatrixUI(AppState.currentEntity);
        saveState();
    }

    AppState.animationId = requestAnimationFrame(loop);
}

export function startAnimation() {
    if (AppState.animationId !== null) cancelAnimationFrame(AppState.animationId);
    AppState.lastWallpaperSwitch = performance.now();
    AppState.animationId = requestAnimationFrame(loop);
}

function stopAnimation() {
    if (AppState.animationId !== null) { cancelAnimationFrame(AppState.animationId); AppState.animationId = null; }
}

// ── Actions ───────────────────────────────────────────────────────────────

function togglePause() {
    AppState.isPaused = !AppState.isPaused;
    setPausedVisual(AppState.isPaused);
    updateRecordButton();

    if (AppState.isPaused) {
        if (AppState.animationId !== null) {
            cancelAnimationFrame(AppState.animationId);
            AppState.animationId = null;
        }
    } else {
        startAnimation();
    }
    saveState();
}

function hardReset() {
    AppState.universeSeed          = createUniverseSeed();
    AppState.universeDecoder       = new DecoderNetwork();
    AppState.currentEntity         = new LatentEntity();
    AppState.generationCount       = 0;
    AppState.lastParams            = null;
    AppState.lastForwardState      = null;
    AppState.previousDecoderState  = null;
    latentTrail.length             = 0;
    AppState.lastPersistFrame      = 0;
    randomizeRuntimeControls();
    AppState.manualPaletteIndices  = [];
    AppState.colorLimit            = 0;
    AppState.growthStart           = null;
    AppState.growthDelta           = null;
    AppState.growthStepCount       = 0;
    AppState.wipeTarget            = null;
    AppState.wipeCanvas            = null;
    AppState.wipeStepCount         = 0;
    AppState.dimTarget             = null;
    AppState.dimIndex              = 0;
    AppState.layerMode             = 'auto';
    AppState.activationMode        = 'relu';

    updateText('gen-counter', AppState.generationCount);
    syncControlUI();
    updateMatrixUI(AppState.currentEntity);
    drawArt(getCanvas(), AppState.currentEntity);
    saveState();

    if (!AppState.isPaused) startAnimation();
}

function jumpLatentRegion() {
    if (!AppState.currentEntity) return;
    AppState.currentEntity.jump(0.55);
    latentTrail.length            = 0;
    AppState.previousDecoderState = null;
    AppState.growthStart          = null;
    AppState.growthDelta          = null;
    AppState.wipeTarget           = null;
    AppState.wipeCanvas           = null;
    AppState.wipeStepCount        = 0;
    AppState.dimTarget            = null;
    AppState.dimIndex             = 0;
    drawArt(getCanvas(), AppState.currentEntity);
    updateMatrixUI(AppState.currentEntity);
    saveState();
}

// ── Self-tests ────────────────────────────────────────────────────────────

function runSelfTests() {
    try {
        const decoder = new DecoderNetwork();
        const entity  = new LatentEntity();

        assert(decoder instanceof DecoderNetwork, 'DecoderNetwork should initialize');
        assert(entity instanceof LatentEntity, 'LatentEntity should initialize');
        assert(entity.z.length === LATENT_DIM, 'Latent vector dimension should match LATENT_DIM');
        assert(entity.velocity.length === LATENT_DIM, 'Velocity vector dimension should match LATENT_DIM');

        const output = decoder.decode(entity.z);
        assert(output instanceof Float32Array, 'Decoder output should be Float32Array');
        assert(output.length === OUT_DIM, 'Decoder output length should match OUT_DIM');

        const forwardState = decoder.forward(entity.z);
        assert(forwardState.h1.length === HIDDEN_1, 'Forward h1 length should match HIDDEN_1');
        assert(forwardState.h2.length === HIDDEN_2, 'Forward h2 length should match HIDDEN_2');
        assert(forwardState.out.length === OUT_DIM, 'Forward out length should match OUT_DIM');

        const beforeStep = entity.z[0];
        entity.step(0.04);
        assert(Number.isFinite(entity.z[0]), 'Latent step should keep finite values');
        assert(beforeStep !== entity.z[0], 'Latent step should change state');

        const params = entity.getPhysicalParams(decoder);
        assert(Array.isArray(params.paletteIndices), 'Palette index list should be an array');
        assert(params.paletteIndices.length >= 1, 'Palette should contain at least one active color');
        assert(params.paletteIndices.length <= 32, 'Palette should be capped at 32 colors');
        assert(params.vDensity > 0, 'vDensity should be positive');
        assert(params.hDensity > 0, 'hDensity should be positive');
        assert(params.stepMod > 0, 'stepMod should be positive');
        assert(params.vSkipRate >= 0 && params.vSkipRate <= 0.28, 'vSkipRate out of expected range');
        assert(params.hSkipRate >= 0 && params.hSkipRate <= 0.28, 'hSkipRate out of expected range');
        assert(params._forwardState && params._forwardState.out.length === OUT_DIM, 'Params should include forward state');

        assert(latentProjector.x instanceof Float32Array, 'latentProjector.x should initialize');
        assert(latentProjector.y instanceof Float32Array, 'latentProjector.y should initialize');

        const projected = projectLatentTo2D(entity.z);
        assert(Number.isFinite(projected.x) && Number.isFinite(projected.y), '2D latent projection should be finite');

        const testStripes = generateStripes(
            'vertical', 100,
            { density: 0.03, widthMean: 1.0, widthJitter: 1.0, skipRate: 0.0, minWidth: 0.01, clusterBias: 1.0, zBias: 0.0 },
            () => '#000000',
            { whitespaceBias: 0.0, zSpread: 1.0, globalZBias: 0.0 }
        );
        assert(testStripes.length > 0, 'generateStripes should create stripes');
        assert(testStripes.every(s => Number.isInteger(s.pos)), 'Stripe positions should be pixel-aligned integers');
        assert(testStripes.every(s => Number.isInteger(s.size)), 'Stripe sizes should be pixel-aligned integers');
        assert(testStripes.every(s => s.size >= 1), 'Stripe sizes should be at least 1 pixel');

        const testRadial = generateRadialSegments(
            'sector', TAU,
            { density: 0.2, widthMean: 1.0, widthJitter: 1.0, skipRate: 0.0, minWidth: 0.02, clusterBias: 1.0, zBias: 0.0 },
            () => '#000000',
            { whitespaceBias: 0.0, zSpread: 1.0, globalZBias: 0.0 }
        );
        assert(testRadial.length > 0, 'generateRadialSegments should create radial parts');
        assert(testRadial.every(s => s.pos >= 0 && s.size > 0), 'Radial parts should have positive spans');

        const beforeJump = entity.z[1];
        entity.jump(0.95);
        assert(Number.isFinite(entity.z[1]), 'Latent jump should keep finite values');
        assert(beforeJump !== entity.z[1], 'Latent jump should change state');

        assert(typeof hardReset === 'function', 'hardReset should be defined');
        assert(typeof togglePause === 'function', 'togglePause should be defined');
        assert(typeof jumpLatentRegion === 'function', 'jumpLatentRegion should be defined');

        const colors = params.paletteIndices.map(idx => classicPalette.colors[idx]);
        assert(colors.every(c => typeof c === 'string' && c.startsWith('#')), 'Palette colors should be valid hex strings');

        // Serialisation round-trip
        const decSerial = serializeDecoder(decoder);
        const decRestored = restoreDecoder(decSerial);
        const outOrig  = decoder.decode(entity.z);
        const outRest  = decRestored.decode(entity.z);
        assert(outOrig.every((v, i) => Math.abs(v - outRest[i]) < 1e-4), 'decoder serialise round-trip');
        const entSerial = serializeEntity(entity);
        const entRest   = restoreEntity(entSerial);
        assert(entRest.z.every((v, i) => Math.abs(v - entity.z[i]) < 1e-4), 'entity serialise round-trip');

        console.info('[Self-test] All checks passed.');
    } catch (err) {
        console.error('[Self-test] FAILED:', err.message);
    }
}

// ── Window globals (Wallpaper Engine + legacy + test harness) ─────────────

Object.assign(window, {
    togglePause,
    hardReset,
    jumpLatentRegion,
    nextWallpaper,
    setAxisMode,
    setGeometryMode,
    setLayerMode,
    setActivationMode,
    setColorLimit,
    setRandomness,
    clearManualPalette,
    toggleSequenceRecording,
    exportUniverseBatchZip,
    exportMainCanvas,
    setWallpaperMode,
    setFrostedBlur,
    setGrowthSteps,
    setGrowthOvershoot,
    drawArt,
    getCanvas,
    startAnimation,
    setPalette,
    AppState,
    FPS_LIMIT,
    FRAME_DELAY,
});

// Live read-through for isPaused (mirrors the app's current state).
Object.defineProperty(window, 'isPaused', {
    get: () => AppState.isPaused,
    configurable: true,
});

// ── Entry point ───────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
