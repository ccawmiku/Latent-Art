/**
 * state.js — persistence (localStorage) and runtime snapshot/restore.
 *
 * Loads both v3 (pre-refactor, geometryMode) and v4 (rendererName +
 * activePaletteName) formats; saves v4. New fields default gracefully when
 * absent.
 */

import { AppState }                            from './appState.js';
import { DecoderNetwork }                      from './decoder.js';
import { LatentEntity }                        from './entity.js';
import { STORAGE_KEY }                         from './constants.js';
import { clamp, createCanvasSeed }           from './math.js';
import { listRenderers, setActiveRendererName, getActiveRendererName } from './renderers/registry.js';
import { listPalettes,  setActivePaletteName,  getActivePaletteName  } from './palettes/registry.js';
import { latentTrail }                         from './latentMap.js';

// ── Serialisation helpers ─────────────────────────────────────────────────

function serializeArr(arr) {
    return Array.from(arr, v => Number(v.toFixed(6)));
}

function loadArr(target, source) {
    if (Array.isArray(source) && source.length === target.length) {
        target.set(source);
        return true;
    }
    return false;
}

export function serializeDecoder(decoder) {
    if (!decoder) return null;
    return {
        w1: serializeArr(decoder.w1), b1: serializeArr(decoder.b1),
        w2: serializeArr(decoder.w2), b2: serializeArr(decoder.b2),
        w3: serializeArr(decoder.w3), b3: serializeArr(decoder.b3),
    };
}

export function restoreDecoder(data) {
    const d = new DecoderNetwork();
    if (!data) return d;
    loadArr(d.w1, data.w1); loadArr(d.b1, data.b1);
    loadArr(d.w2, data.w2); loadArr(d.b2, data.b2);
    loadArr(d.w3, data.w3); loadArr(d.b3, data.b3);
    return d;
}

export function serializeEntity(entity) {
    if (!entity) return null;
    return { z: serializeArr(entity.z), velocity: serializeArr(entity.velocity) };
}

export function restoreEntity(data) {
    const e = new LatentEntity();
    if (!data) return e;
    loadArr(e.z, data.z);
    loadArr(e.velocity, data.velocity);
    return e;
}

// ── Save ──────────────────────────────────────────────────────────────────

export function saveState() {
    if (!window.localStorage || !AppState.currentEntity || !AppState.canvasDecoder) return;
    try {
        const payload = {
            version:              4,
            canvasSeed:         AppState.canvasSeed,
            generationCount:      AppState.generationCount,
            colorLimit:           AppState.colorLimit,
            randomnessLevel:      AppState.randomnessLevel,
            axisMode:             AppState.axisMode,
            rendererName:         getActiveRendererName(),
            layerMode:            AppState.layerMode,
            activationMode:       AppState.activationMode,
            activePaletteName:    getActivePaletteName(),
            manualPaletteIndices: AppState.manualPaletteIndices,
            currentLanguage:      AppState.currentLanguage,
            wallpaperRandomMode:  AppState.wallpaperRandomMode,
            wallpaperDisplayMode: AppState.wallpaperDisplayMode,
            wallpaperMode:        AppState.wallpaperMode,
            frostedBlur:          AppState.frostedBlur,
            wallpaperSwitchSeconds: AppState.wallpaperSwitchSeconds,
            wallpaperOuterColor:  AppState.wallpaperOuterColor,
            growthSteps:     AppState.growthSteps,
            growthOvershoot: AppState.growthOvershoot,
            wipeCell:        AppState.wipeCell,
            wipeOrder:       AppState.wipeOrder,
            entity:               serializeEntity(AppState.currentEntity),
            decoder:              serializeDecoder(AppState.canvasDecoder),
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
        console.warn('[State] Save skipped:', err.message);
    }
}

export function maybePersistState() {
    if (AppState.generationCount - AppState.lastPersistFrame < 48) return;
    AppState.lastPersistFrame = AppState.generationCount;
    saveState();
}

// ── Restore ───────────────────────────────────────────────────────────────

export function restoreSavedState() {
    if (!window.localStorage) return false;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const s = JSON.parse(raw);
        if (!s || ![3, 4].includes(s.version)) return false;

        // Rename migration: legacy saves used `universeSeed` / `'universe'` mode
        AppState.canvasSeed      = Number.isFinite(s.canvasSeed) ? s.canvasSeed >>> 0
            : (Number.isFinite(s.universeSeed) ? s.universeSeed >>> 0 : createCanvasSeed());
        AppState.canvasDecoder   = restoreDecoder(s.decoder);
        AppState.currentEntity     = restoreEntity(s.entity);
        AppState.generationCount   = Number.isFinite(s.generationCount) ? Math.max(0, Math.floor(s.generationCount)) : 0;
        AppState.colorLimit        = Number.isFinite(s.colorLimit) ? clamp(Math.floor(s.colorLimit), 0, 32) : 0;
        AppState.randomnessLevel   = Number.isFinite(s.randomnessLevel) ? clamp(s.randomnessLevel, 0, 1) : 0.4;
        AppState.axisMode          = ['both', 'x', 'y'].includes(s.axisMode) ? s.axisMode : 'both';
        AppState.layerMode         = ['auto', 'xTop', 'yTop'].includes(s.layerMode) ? s.layerMode : 'auto';
        AppState.activationMode    = ['relu', 'leaky', 'tanh', 'swish'].includes(s.activationMode) ? s.activationMode : 'relu';
        AppState.currentLanguage   = s.currentLanguage === 'zh' ? 'zh' : 'en';
        const rawMode = s.wallpaperRandomMode === 'universe' ? 'canvas' : s.wallpaperRandomMode;
        AppState.wallpaperRandomMode  = ['growth', 'canvas'].includes(rawMode) ? rawMode : 'growth';
        AppState.wallpaperDisplayMode = ['fill', 'square'].includes(s.wallpaperDisplayMode) ? s.wallpaperDisplayMode : 'square';
        AppState.wallpaperMode    = ['normal', 'frosted'].includes(s.wallpaperMode) ? s.wallpaperMode : 'normal';
        AppState.frostedBlur      = Number.isFinite(s.frostedBlur) ? clamp(Math.round(s.frostedBlur), 0, 40) : 16;
        AppState.wallpaperSwitchSeconds = Number.isFinite(s.wallpaperSwitchSeconds)
            ? clamp(Math.round(s.wallpaperSwitchSeconds * 10) / 10, 0.1, 3600) : 1;
        AppState.wallpaperOuterColor = /^#[0-9a-f]{6}$/i.test(s.wallpaperOuterColor || '')
            ? s.wallpaperOuterColor : '#ffffff';
        AppState.growthSteps     = Number.isFinite(s.growthSteps) ? clamp(Math.floor(s.growthSteps), 5, 120) : 30;
        AppState.growthOvershoot = Number.isFinite(s.growthOvershoot) ? clamp(Math.round(s.growthOvershoot), 0, 100) : 65;
        AppState.wipeCell        = [4, 8, 16, 32, 64].includes(s.wipeCell) ? s.wipeCell : 16;
        AppState.wipeOrder       = s.wipeOrder === 'random' ? 'random' : 'ordered';
        AppState.growthStart     = null;   // transient — regenerated on first growth step
        AppState.growthDelta     = null;
        AppState.growthStepCount = 0;
        AppState.wipeTarget      = null;   // transient — regenerated on first wipe step
        AppState.wipeParts       = null;
        AppState.wipeDrawFrame   = null;
        AppState.wipeSequence    = null;
        AppState.wipeStepCount   = 0;
        AppState.wipeSize        = null;
        AppState.lastRender      = null;
        AppState.dimTarget       = null;   // transient — regenerated on first dim step
        AppState.dimIndex        = 0;
        AppState.manualPaletteIndices = Array.isArray(s.manualPaletteIndices)
            ? s.manualPaletteIndices.map(x => Math.floor(x)).filter(x => x >= 0 && x < 32) : [];
        AppState.lastPersistFrame  = AppState.generationCount;

        // v3 → v4 migration: geometryMode → rendererName
        const rawRenderer = s.rendererName || s.geometryMode || 'linear';
        const availR      = listRenderers();
        setActiveRendererName(availR.includes(rawRenderer) ? rawRenderer : 'linear');

        // Palette name (defaults to 'classic' for v3 states)
        const rawPalette = s.activePaletteName || 'classic';
        const availP     = listPalettes();
        setActivePaletteName(availP.includes(rawPalette) ? rawPalette : 'classic');

        return true;
    } catch (err) {
        console.warn('[State] Restore skipped:', err.message);
        return false;
    }
}

// ── Runtime snapshot (used by export/canvas-batch) ─────────────────────

export function snapshotRuntimeState() {
    return {
        canvasSeed:          AppState.canvasSeed,
        canvasDecoder:       AppState.canvasDecoder,
        currentEntity:         AppState.currentEntity,
        generationCount:       AppState.generationCount,
        colorLimit:            AppState.colorLimit,
        randomnessLevel:       AppState.randomnessLevel,
        manualPaletteIndices:  AppState.manualPaletteIndices.slice(),
        lastActivePaletteIndices: AppState.lastActivePaletteIndices.slice(),
        lastParams:            AppState.lastParams,
        lastForwardState:      AppState.lastForwardState,
        previousDecoderState:  AppState.previousDecoderState,
        lastLatentSpeed:       AppState.lastLatentSpeed,
        latentTrailCopy:       latentTrail.map(p => ({ ...p })),
    };
}

export function restoreRuntimeState(snap) {
    if (!snap) return;
    AppState.canvasSeed            = snap.canvasSeed;
    AppState.canvasDecoder         = snap.canvasDecoder;
    AppState.currentEntity           = snap.currentEntity;
    AppState.generationCount         = snap.generationCount;
    AppState.colorLimit              = snap.colorLimit;
    AppState.randomnessLevel         = snap.randomnessLevel;
    AppState.manualPaletteIndices    = snap.manualPaletteIndices;
    AppState.lastActivePaletteIndices = snap.lastActivePaletteIndices;
    AppState.lastParams              = snap.lastParams;
    AppState.lastForwardState        = snap.lastForwardState;
    AppState.previousDecoderState    = snap.previousDecoderState;
    AppState.lastLatentSpeed         = snap.lastLatentSpeed;
    latentTrail.length = 0;
    latentTrail.push(...(snap.latentTrailCopy || []));
}
