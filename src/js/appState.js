/**
 * Central mutable application state.
 *
 * ES modules are singletons — importing AppState from different modules always
 * gives the same object reference, so mutations are shared globally.
 * Use explicit property assignment (AppState.foo = bar) to update state.
 */
export const AppState = {
    // ── Core simulation ───────────────────────────────────────────────
    /** @type {import('./decoder.js').DecoderNetwork|null} */
    universeDecoder:  null,
    /** @type {import('./entity.js').LatentEntity|null} */
    currentEntity:    null,
    universeSeed:     1,
    generationCount:  0,

    // ── Playback ──────────────────────────────────────────────────────
    isPaused:             false,
    animationId:          null,
    lastWallpaperSwitch:  0,
    hasBootstrapped:      false,

    // ── Wallpaper modes ───────────────────────────────────────────────
    wallpaperRandomMode:   'growth',   // 'growth' | 'universe'
    wallpaperDisplayMode:  'square',   // 'fill' | 'square'
    wallpaperSwitchSeconds: 1,
    wallpaperOuterColor:   '#ffffff',

    // ── Render config ─────────────────────────────────────────────────
    axisMode:       'both',   // 'both' | 'x' | 'y'
    layerMode:      'auto',   // 'auto' | 'xTop' | 'yTop'
    activationMode: 'relu',   // 'relu' | 'leaky' | 'tanh' | 'swish'
    colorLimit:     0,        // 0 = auto
    randomnessLevel: 0.4,

    // ── Palette selection ─────────────────────────────────────────────
    manualPaletteIndices:     [],
    lastActivePaletteIndices: [],

    // ── Frame data ────────────────────────────────────────────────────
    lastParams:            null,
    lastForwardState:      null,
    previousDecoderState:  null,
    lastPersistFrame:      0,
    lastLatentSpeed:       0,

    // ── Export / recording ────────────────────────────────────────────
    isRecordingSequence:    false,
    sequenceRecorder:       null,
    isRecordingUniverseBatch: false,

    // ── I18n ──────────────────────────────────────────────────────────
    currentLanguage: 'en',   // 'en' | 'zh'
};

/** Nudge randomness to a fresh value (used by hardReset / fresh universes). */
export function randomizeRuntimeControls() {
    AppState.randomnessLevel = 0.18 + Math.random() * 0.62;
}
