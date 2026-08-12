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
    wallpaperMode:         'normal',   // 'normal' | 'frosted'
    frostedBlur:           16,         // px — Gaussian blur strength for frosted mode
    wallpaperSwitchSeconds: 1,
    wallpaperOuterColor:   '#ffffff',

    // ── Growth-mode journey (linear toward a target latent B) ─────────
    growthSteps:     30,   // max steps per journey (5-120)
    growthOvershoot: 65,   // overshoot fraction 0-100 — landing = B + os·(B−A)
    growthStart:     null, // Float32Array A₀ — transient, not persisted
    growthDelta:     null, // Float32Array B−A₀ — transient, not persisted
    growthStepCount: 0,

    // ── Wipe (逐条) journey — reveal target image's structural pieces
    wipeCell:       16,   // structural grid cell px: 4|8|16|32|64 (persisted)
    wipeOrder:      'ordered', // 'ordered' = bottom→top draw order | 'random' = random xy
    wipeTarget:     null, // Float32Array B — transient, not persisted
    wipeCanvas:     null, // offscreen render of B — transient, not persisted
    wipeUnits:      null, // shuffled [{x,y,w,h}] reveal rects tiling the canvas
    wipeStepCount:  0,

    // ── Dim (逐维) journey — flip one latent dim per step
    dimTarget:      null, // Float32Array B — transient, not persisted
    dimIndex:       0,

    // Renderer structural parts from the last drawArt (used by wipe target render)
    lastParts:      null, // transient, not persisted
    lastEdgeExpand: 0,    // matching draw dilation for exact stripe fills

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
