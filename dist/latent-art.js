(() => {
  // src/js/math.js
  var sigmoid = (x) => 1 / (1 + Math.exp(-x));
  var relu = (x) => Math.max(0, x);
  var tanh = (x) => Math.tanh(x);
  var leakyRelu = (x) => x > 0 ? x : x * 0.08;
  var swish = (x) => x * sigmoid(x);
  var clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  var lerp = (a, b, t2) => a + (b - a) * t2;
  function randUniform(scale = 1) {
    return (Math.random() * 2 - 1) * scale;
  }
  function randNormal() {
    const u = Math.max(Math.random(), 1e-12);
    const v = Math.max(Math.random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function createUniverseSeed() {
    return (Math.floor(Math.random() * 4294967295) || 1) >>> 0;
  }
  function hashString(value) {
    const str = String(value);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function unitFromHash(hash) {
    let x = hash >>> 0;
    x ^= x >>> 16;
    x = Math.imul(x, 2246822507);
    x ^= x >>> 13;
    x = Math.imul(x, 3266489909);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967296;
  }
  function hexToRgb(hex) {
    const v = hex.replace("#", "");
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16)
    };
  }
  function scientificColor(t2, alpha = 1) {
    const stops = ["#440154", "#414487", "#2A788E", "#22A884", "#7AD151", "#FDE725"].map(hexToRgb);
    const x = clamp(t2, 0, 1) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const f = x - i;
    const a = stops[i];
    const b = stops[i + 1];
    return `rgba(${Math.round(lerp(a.r, b.r, f))},${Math.round(lerp(a.g, b.g, f))},${Math.round(lerp(a.b, b.b, f))},${alpha})`;
  }
  function assert(condition, message) {
    if (!condition) throw new Error(`Self-test failed: ${message}`);
  }

  // src/js/constants.js
  var LATENT_DIM = 192;
  var HIDDEN_1 = 96;
  var HIDDEN_2 = 64;
  var OUT_DIM = 64;
  var FPS_LIMIT = 8;
  var FRAME_DELAY = 1e3 / FPS_LIMIT;
  var MAX_TRAIL_POINTS = 240;
  var STORAGE_KEY = "latent-art-canvas-v3-state";
  var STRIPE_DENSITY_SCALE = 0.62;
  var TAU = Math.PI * 2;

  // src/js/renderers/base.js
  function assertRenderer(name, renderer) {
    if (typeof renderer?.render !== "function") {
      throw new Error(`Renderer "${name}" must export a render() function`);
    }
    if (typeof renderer.label !== "string") {
      throw new Error(`Renderer "${name}" must have a string label`);
    }
  }

  // src/js/renderers/registry.js
  var _renderers = /* @__PURE__ */ new Map();
  var _activeName = "linear";
  function registerRenderer(name, renderer) {
    assertRenderer(name, renderer);
    _renderers.set(name, renderer);
  }
  function getRenderer(name) {
    return _renderers.get(name) ?? _renderers.get("linear");
  }
  function listRenderers() {
    return [..._renderers.keys()];
  }
  function setActiveRendererName(name) {
    if (_renderers.has(name)) _activeName = name;
  }
  function getActiveRendererName() {
    return _activeName;
  }
  function getActiveRenderer() {
    return getRenderer(_activeName);
  }

  // src/js/renderers/sort.js
  function sortPartsForLayerMode(parts, layerMode) {
    if (layerMode === "xTop") {
      parts.sort((a, b) => {
        const ax = a.dir === "vertical" || a.dir === "sector" ? 1 : 0;
        const bx = b.dir === "vertical" || b.dir === "sector" ? 1 : 0;
        return ax - bx || a.z - b.z;
      });
    } else if (layerMode === "yTop") {
      parts.sort((a, b) => {
        const ay = a.dir === "horizontal" || a.dir === "ring" ? 1 : 0;
        const by = b.dir === "horizontal" || b.dir === "ring" ? 1 : 0;
        return ay - by || a.z - b.z;
      });
    } else {
      parts.sort((a, b) => a.z - b.z);
    }
  }
  function getLayerLabel(layerMode, isRadial = false) {
    if (layerMode === "xTop") return isRadial ? "SECTOR TOP" : "VERT TOP";
    if (layerMode === "yTop") return isRadial ? "RING TOP" : "HORIZ TOP";
    return "AUTO";
  }

  // src/js/renderers/linear.js
  function generateStripes(dir, span, config, pickColor, globalConfig, sampler = null) {
    const stripes = [];
    const combinedSkip = clamp(config.skipRate + globalConfig.whitespaceBias, 0, 0.42);
    let current = 0;
    let stripeIndex = 0;
    while (current < span) {
      const widthNoise = sampler ? sampler(`width:${stripeIndex}`) : Math.random();
      const sampled = span * config.density * config.widthMean * (0.35 + Math.pow(widthNoise, 1 + config.clusterBias) * config.widthJitter);
      const minWidthPx = Math.max(1, Math.round(span * config.minWidth));
      const rawEnd = Math.min(span, current + Math.max(sampled, minWidthPx));
      const startPx = Math.round(current);
      let endPx = Math.round(rawEnd);
      if (endPx <= startPx) endPx = startPx + 1;
      const stripeSize = endPx - startPx;
      if (stripeSize <= 0) break;
      const keepNoise = sampler ? sampler(`keep:${stripeIndex}`) : Math.random();
      if (keepNoise > combinedSkip) {
        stripes.push({
          dir,
          pos: startPx,
          size: stripeSize,
          color: pickColor(`color:${stripeIndex}`),
          z: (sampler ? sampler(`z:${stripeIndex}`) : Math.random()) * globalConfig.zSpread + config.zBias + globalConfig.globalZBias
        });
      }
      current = rawEnd;
      stripeIndex++;
    }
    return stripes;
  }
  function drawLinearParts(ctx, w, h, parts, params) {
    ctx.globalAlpha = 1;
    for (const s of parts) {
      ctx.fillStyle = s.color;
      if (s.dir === "vertical") {
        ctx.fillRect(
          Math.round(s.pos),
          0,
          Math.max(1, Math.round(s.size + params.edgeExpand)),
          h
        );
      } else {
        ctx.fillRect(
          0,
          Math.round(s.pos),
          w,
          Math.max(1, Math.round(s.size + params.edgeExpand))
        );
      }
    }
  }
  var linearRenderer = {
    label: "STRIPES",
    /** @param {CanvasRenderingContext2D} ctx @param {import('./base.js').RenderContext} c */
    render(ctx, c) {
      const { params, axisMode, layerMode, vSampler, hSampler, vPickColor, hPickColor, paletteColors } = c;
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, w, h);
      const vConfig = {
        density: params.vDensity * STRIPE_DENSITY_SCALE * (0.75 + params.familyBalance * 0.5),
        widthMean: params.vWidthMean,
        widthJitter: params.vWidthJitter,
        skipRate: params.vSkipRate,
        minWidth: params.vMinWidth,
        clusterBias: params.vClusterBias,
        zBias: params.vZBias
      };
      const hConfig = {
        density: params.hDensity * STRIPE_DENSITY_SCALE * (1.25 - params.familyBalance * 0.5),
        widthMean: params.hWidthMean,
        widthJitter: params.hWidthJitter,
        skipRate: params.hSkipRate,
        minWidth: params.hMinWidth,
        clusterBias: params.hClusterBias,
        zBias: params.hZBias
      };
      const gConfig = { whitespaceBias: params.whitespaceBias, zSpread: params.zSpread, globalZBias: params.globalZBias };
      const vStripes = generateStripes("vertical", w, vConfig, vPickColor, gConfig, vSampler);
      const hStripes = generateStripes("horizontal", h, hConfig, hPickColor, gConfig, hSampler);
      let parts = [];
      if (axisMode === "both" || axisMode === "x") parts = parts.concat(vStripes);
      if (axisMode === "both" || axisMode === "y") parts = parts.concat(hStripes);
      if (parts.length < 3) {
        if (axisMode === "both" || axisMode === "x")
          parts.push({ dir: "vertical", pos: 0, size: Math.round(w * 0.28), color: paletteColors[0], z: 0 });
        if (axisMode === "both" || axisMode === "y")
          parts.push({ dir: "horizontal", pos: Math.round(h * 0.2), size: Math.round(h * 0.38), color: paletteColors[6], z: 1 });
      }
      sortPartsForLayerMode(parts, layerMode);
      drawLinearParts(ctx, w, h, parts, params);
    }
  };
  registerRenderer("linear", linearRenderer);

  // src/js/renderers/radial.js
  function generateRadialSegments(dir, span, config, pickColor, globalConfig, sampler = null) {
    const segments = [];
    const combinedSkip = clamp(config.skipRate + globalConfig.whitespaceBias, 0, 0.42);
    let current = 0;
    let segmentIndex = 0;
    while (current < span) {
      const widthNoise = sampler ? sampler(`width:${segmentIndex}`) : Math.random();
      const sampled = span * config.density * config.widthMean * (0.35 + Math.pow(widthNoise, 1 + config.clusterBias) * config.widthJitter);
      const minSize = span * config.minWidth;
      const size = Math.max(sampled, minSize);
      const end = Math.min(span, current + size);
      const segSize = end - current;
      if (segSize <= 1e-4) break;
      const keepNoise = sampler ? sampler(`keep:${segmentIndex}`) : Math.random();
      if (keepNoise > combinedSkip) {
        segments.push({
          dir,
          pos: current,
          size: segSize,
          color: pickColor(`color:${segmentIndex}`),
          z: (sampler ? sampler(`z:${segmentIndex}`) : Math.random()) * globalConfig.zSpread + config.zBias + globalConfig.globalZBias
        });
      }
      current = end;
      segmentIndex++;
    }
    return segments;
  }
  function drawRadialParts(ctx, w, h, parts, backgroundColor) {
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.47;
    const angleOverlap = 35e-4;
    const radialOverlap = Math.max(2, radius * 4e-3);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.clip();
    ctx.fillStyle = backgroundColor || "#fafafa";
    ctx.fillRect(0, 0, w, h);
    for (const s of parts) {
      ctx.fillStyle = s.color;
      if (s.dir === "sector") {
        const start = -Math.PI / 2 + s.pos - angleOverlap;
        const end = -Math.PI / 2 + s.pos + s.size + angleOverlap;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius + radialOverlap, start, end);
        ctx.closePath();
        ctx.fill();
      } else {
        const inner = Math.max(0, s.pos - radialOverlap);
        const outer = Math.min(radius + radialOverlap, s.pos + s.size + radialOverlap);
        if (outer <= inner) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, TAU);
        if (inner > 0) ctx.arc(cx, cy, inner, TAU, 0, true);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }
  var radialRenderer = {
    label: "CIRCLE",
    /** @param {CanvasRenderingContext2D} ctx @param {import('./base.js').RenderContext} c */
    render(ctx, c) {
      const { params, axisMode, layerMode, vSampler, hSampler, vPickColor, hPickColor, paletteColors } = c;
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const radius = Math.min(w, h) * 0.47;
      const gConfig = { whitespaceBias: params.whitespaceBias, zSpread: params.zSpread, globalZBias: params.globalZBias };
      const sectorSegs = generateRadialSegments("sector", TAU, {
        density: params.vDensity * STRIPE_DENSITY_SCALE * 0.92 * (0.75 + params.familyBalance * 0.5),
        widthMean: params.vWidthMean,
        widthJitter: params.vWidthJitter,
        skipRate: params.vSkipRate,
        minWidth: Math.max(6e-3, params.vMinWidth * 1.1),
        clusterBias: params.vClusterBias,
        zBias: params.vZBias
      }, vPickColor, gConfig, vSampler);
      const ringSegs = generateRadialSegments("ring", radius, {
        density: params.hDensity * STRIPE_DENSITY_SCALE * (1.25 - params.familyBalance * 0.5),
        widthMean: params.hWidthMean,
        widthJitter: params.hWidthJitter,
        skipRate: params.hSkipRate,
        minWidth: params.hMinWidth,
        clusterBias: params.hClusterBias,
        zBias: params.hZBias
      }, hPickColor, gConfig, hSampler);
      let parts = [];
      if (axisMode === "both" || axisMode === "x") parts = parts.concat(sectorSegs);
      if (axisMode === "both" || axisMode === "y") parts = parts.concat(ringSegs);
      if (parts.length < 3) {
        if (axisMode === "both" || axisMode === "x")
          parts.push({ dir: "sector", pos: 0, size: TAU * 0.18, color: paletteColors[0], z: 0 });
        if (axisMode === "both" || axisMode === "y")
          parts.push({ dir: "ring", pos: radius * 0.24, size: radius * 0.28, color: paletteColors[6], z: 1 });
      }
      const bg = params.paletteIndices.length > 0 ? paletteColors[params.paletteIndices[0]] ?? "#fafafa" : "#fafafa";
      sortPartsForLayerMode(parts, layerMode);
      drawRadialParts(ctx, w, h, parts, bg);
    }
  };
  registerRenderer("radial", radialRenderer);

  // src/js/renderers/pixelGrid.js
  var pixelGridRenderer = {
    label: "PIXELS",
    /** @param {CanvasRenderingContext2D} ctx @param {import('./base.js').RenderContext} c */
    render(ctx, c) {
      const { params, axisMode, layerMode, vSampler, hSampler, vPickColor, hPickColor } = c;
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const cols = Math.max(4, Math.round(w * params.vDensity * 22) + 2);
      const rows = Math.max(4, Math.round(h * params.hDensity * 22) + 2);
      const cellW = w / cols;
      const cellH = h / rows;
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, 0, w, h);
      const skip = clamp(
        (params.vSkipRate + params.hSkipRate) / 2 + params.whitespaceBias,
        0,
        0.5
      );
      const gap = params.edgeExpand > 0 ? 0 : 1;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const salt = `${col}:${row}`;
          if (vSampler(`keep:${salt}`) <= skip) continue;
          let color;
          if (axisMode === "x") {
            color = vPickColor(`c:${salt}`);
          } else if (axisMode === "y") {
            color = hPickColor(`c:${salt}`);
          } else {
            const vZ = vSampler(`z:${col}`) * params.zSpread + params.vZBias + params.globalZBias;
            const hZ = hSampler(`z:${row}`) * params.zSpread + params.hZBias + params.globalZBias;
            if (layerMode === "xTop") {
              color = vPickColor(`c:${salt}`);
            } else if (layerMode === "yTop") {
              color = hPickColor(`c:${salt}`);
            } else {
              color = vZ > hZ ? vPickColor(`c:${salt}`) : hPickColor(`c:${salt}`);
            }
          }
          const px = Math.round(col * cellW);
          const py = Math.round(row * cellH);
          const cw = Math.round((col + 1) * cellW) - px;
          const ch = Math.round((row + 1) * cellH) - py;
          ctx.fillStyle = color;
          ctx.fillRect(px, py, Math.max(1, cw - gap), Math.max(1, ch - gap));
        }
      }
    }
  };
  registerRenderer("pixelGrid", pixelGridRenderer);

  // src/js/palettes/registry.js
  var _palettes = /* @__PURE__ */ new Map();
  var _activeName2 = "classic";
  function registerPalette(name, palette) {
    if (!name || typeof palette.label !== "string") {
      throw new Error(`Palette "${name}" must have a string label`);
    }
    if (!Array.isArray(palette.colors) || palette.colors.length !== 32) {
      throw new Error(`Palette "${name}" must have exactly 32 colors (got ${palette.colors?.length})`);
    }
    _palettes.set(name, palette);
  }
  function getPalette(name) {
    return _palettes.get(name) ?? _palettes.get("classic") ?? { label: "CLASSIC", colors: Array(32).fill("#000000") };
  }
  function listPalettes() {
    return [..._palettes.keys()];
  }
  function setActivePaletteName(name) {
    if (_palettes.has(name)) _activeName2 = name;
  }
  function getActivePaletteName() {
    return _activeName2;
  }
  function getActivePalette() {
    return getPalette(_activeName2);
  }

  // src/js/palettes/classic.js
  var classicPalette = {
    label: "CLASSIC",
    colors: [
      "#F8F9FA",
      "#FDF5E6",
      "#F0E68C",
      "#FFD700",
      "#DAA520",
      "#FF8C00",
      "#FF4500",
      "#E32636",
      "#B22222",
      "#A0522D",
      "#8B4513",
      "#6B4423",
      "#C71585",
      "#800080",
      "#4B0082",
      "#120A8F",
      "#003399",
      "#0F52BA",
      "#48CAE4",
      "#008080",
      "#50C878",
      "#00FA9A",
      "#228B22",
      "#808000",
      "#556B2F",
      "#D2B48C",
      "#BC8F8F",
      "#708090",
      "#778899",
      "#A9A9A9",
      "#2F4F4F",
      "#191919"
    ]
  };
  registerPalette("classic", classicPalette);

  // src/js/palettes/neon.js
  var neonPalette = {
    label: "NEON",
    colors: [
      "#FF0080",
      "#FF00FF",
      "#8000FF",
      "#4000FF",
      "#0040FF",
      "#0090FF",
      "#00FFFF",
      "#00FF80",
      "#00FF00",
      "#80FF00",
      "#FFFF00",
      "#FFB300",
      "#FF6600",
      "#FF3300",
      "#FF0050",
      "#FF0030",
      "#FF80C0",
      "#FF80FF",
      "#C080FF",
      "#80C0FF",
      "#80FFFF",
      "#80FFCC",
      "#80FF80",
      "#CCFF80",
      "#FFFF80",
      "#FFD480",
      "#FFAA80",
      "#FF8080",
      "#FF80A0",
      "#CC00FF",
      "#0022CC",
      "#006633"
    ]
  };
  registerPalette("neon", neonPalette);

  // src/js/palettes/earth.js
  var earthPalette = {
    label: "EARTH",
    colors: [
      "#8B4513",
      "#A0522D",
      "#6B4423",
      "#D2691E",
      "#CD853F",
      "#DEB887",
      "#F5DEB3",
      "#FFDEAD",
      "#D2B48C",
      "#BC8F8F",
      "#F4A460",
      "#DAA520",
      "#B8860B",
      "#8B7355",
      "#696969",
      "#808080",
      "#556B2F",
      "#6B8E23",
      "#808000",
      "#9ACD32",
      "#228B22",
      "#2E8B57",
      "#3CB371",
      "#20B2AA",
      "#4682B4",
      "#708090",
      "#778899",
      "#2F4F4F",
      "#8B8682",
      "#C0C0C0",
      "#FFFACD",
      "#FAF0E6"
    ]
  };
  registerPalette("earth", earthPalette);

  // src/js/appState.js
  var AppState = {
    // ── Core simulation ───────────────────────────────────────────────
    /** @type {import('./decoder.js').DecoderNetwork|null} */
    universeDecoder: null,
    /** @type {import('./entity.js').LatentEntity|null} */
    currentEntity: null,
    universeSeed: 1,
    generationCount: 0,
    // ── Playback ──────────────────────────────────────────────────────
    isPaused: false,
    animationId: null,
    lastWallpaperSwitch: 0,
    hasBootstrapped: false,
    // ── Wallpaper modes ───────────────────────────────────────────────
    wallpaperRandomMode: "growth",
    // 'growth' | 'universe'
    wallpaperDisplayMode: "square",
    // 'fill' | 'square'
    wallpaperSwitchSeconds: 1,
    wallpaperOuterColor: "#ffffff",
    // ── Render config ─────────────────────────────────────────────────
    axisMode: "both",
    // 'both' | 'x' | 'y'
    layerMode: "auto",
    // 'auto' | 'xTop' | 'yTop'
    activationMode: "relu",
    // 'relu' | 'leaky' | 'tanh' | 'swish'
    colorLimit: 0,
    // 0 = auto
    randomnessLevel: 0.4,
    // ── Palette selection ─────────────────────────────────────────────
    manualPaletteIndices: [],
    lastActivePaletteIndices: [],
    // ── Frame data ────────────────────────────────────────────────────
    lastParams: null,
    lastForwardState: null,
    previousDecoderState: null,
    lastPersistFrame: 0,
    lastLatentSpeed: 0,
    // ── Export / recording ────────────────────────────────────────────
    isRecordingSequence: false,
    sequenceRecorder: null,
    isRecordingUniverseBatch: false,
    // ── I18n ──────────────────────────────────────────────────────────
    currentLanguage: "en"
    // 'en' | 'zh'
  };
  function randomizeRuntimeControls() {
    AppState.randomnessLevel = 0.18 + Math.random() * 0.62;
  }

  // src/js/decoder.js
  function initWeight(length, fanIn, fanOut, gain = 1) {
    const arr = new Float32Array(length);
    const limit = gain * Math.sqrt(6 / (fanIn + fanOut));
    for (let i = 0; i < arr.length; i++) arr[i] = randUniform(limit);
    return arr;
  }
  function getActivation(mode) {
    if (mode === "leaky") return leakyRelu;
    if (mode === "tanh") return tanh;
    if (mode === "swish") return swish;
    return relu;
  }
  function getActivationLabel(mode) {
    if (mode === "leaky") return "LEAKY";
    if (mode === "tanh") return "TANH";
    if (mode === "swish") return "SWISH";
    return "RELU";
  }
  var DecoderNetwork = class {
    constructor() {
      this.w1 = initWeight(LATENT_DIM * HIDDEN_1, LATENT_DIM, HIDDEN_1, 1.15);
      this.b1 = new Float32Array(HIDDEN_1);
      this.w2 = initWeight(HIDDEN_1 * HIDDEN_2, HIDDEN_1, HIDDEN_2, 1.2);
      this.b2 = new Float32Array(HIDDEN_2);
      this.w3 = initWeight(HIDDEN_2 * OUT_DIM, HIDDEN_2, OUT_DIM, 1.1);
      this.b3 = new Float32Array(OUT_DIM);
      for (let i = 0; i < OUT_DIM; i++) this.b3[i] = randUniform(0.2);
    }
    dense(input, inDim, outDim, weights, bias, activation) {
      const out = new Float32Array(outDim);
      for (let i = 0; i < outDim; i++) {
        let sum = bias[i];
        const offset = i * inDim;
        for (let j = 0; j < inDim; j++) sum += input[j] * weights[offset + j];
        out[i] = activation(sum);
      }
      return out;
    }
    /**
     * Full forward pass — returns intermediate activations for visualisation.
     * @param {Float32Array} latentZ
     * @param {'relu'|'leaky'|'tanh'|'swish'} [activationMode='relu']
     * @returns {{ latent: Float32Array, h1: Float32Array, h2: Float32Array, out: Float32Array }}
     */
    forward(latentZ, activationMode = "relu") {
      const h1 = this.dense(latentZ, LATENT_DIM, HIDDEN_1, this.w1, this.b1, (x) => tanh(x));
      const h2 = this.dense(h1, HIDDEN_1, HIDDEN_2, this.w2, this.b2, getActivation(activationMode));
      const out = this.dense(h2, HIDDEN_2, OUT_DIM, this.w3, this.b3, (x) => x);
      return { latent: latentZ, h1, h2, out };
    }
    /** Convenience: returns only the output vector. */
    decode(latentZ, activationMode = "relu") {
      return this.forward(latentZ, activationMode).out;
    }
  };

  // src/js/entity.js
  var LatentEntity = class {
    constructor() {
      this.z = new Float32Array(LATENT_DIM);
      this.velocity = new Float32Array(LATENT_DIM);
      for (let i = 0; i < LATENT_DIM; i++) {
        this.z[i] = randNormal() * 1.2;
        this.velocity[i] = randNormal() * 0.01;
      }
    }
    step(baseSpeed = 0.04) {
      const pullToCenter = 0.012;
      const friction = 0.88;
      for (let i = 0; i < LATENT_DIM; i++) {
        this.velocity[i] = this.velocity[i] * friction + randNormal() * baseSpeed - this.z[i] * pullToCenter * 0.01;
        this.z[i] += this.velocity[i];
        if (this.z[i] > 5.5) this.z[i] -= (this.z[i] - 5.5) * 0.08;
        if (this.z[i] < -5.5) this.z[i] -= (this.z[i] + 5.5) * 0.08;
      }
    }
    jump(amount = 0.9) {
      for (let i = 0; i < LATENT_DIM; i++) {
        this.z[i] += randNormal() * amount;
        this.velocity[i] = randNormal() * 0.02;
      }
    }
    /**
     * Decode physical render parameters from the latent vector.
     *
     * @param {import('./decoder.js').DecoderNetwork} decoder
     * @param {'relu'|'leaky'|'tanh'|'swish'} [activationMode='relu']
     * @param {{ colorLimit?: number, manualPaletteIndices?: number[] }} [opts]
     * @returns {object} params
     */
    getPhysicalParams(decoder, activationMode = "relu", opts = {}) {
      const { colorLimit = 0, manualPaletteIndices = [] } = opts;
      const forwardState = decoder.forward(this.z, activationMode);
      const raw = forwardState.out;
      const colorThreshold = raw[0] * 0.85;
      const colorTemperature = 0.7 + sigmoid(raw[1]) * 1.5;
      const decodedColorTarget = 1 + Math.floor(sigmoid(raw[2]) * 31.999);
      const requestedColorCount = colorLimit > 0 ? colorLimit : decodedColorTarget;
      const stepMod = 6e-3 + sigmoid(raw[3]) * 0.014;
      const zSpread = 0.15 + sigmoid(raw[4]) * 0.85;
      const globalZBias = tanh(raw[5]) * 0.25;
      const accentBias = sigmoid(raw[6]);
      const whitespaceBias = sigmoid(raw[7]) * 0.08;
      const vDensity = 6e-3 + sigmoid(raw[8]) * 0.11;
      const vWidthMean = 0.45 + sigmoid(raw[9]) * 1.85;
      const vWidthJitter = 0.25 + sigmoid(raw[10]) * 1.75;
      const vSkipRate = sigmoid(raw[11]) * 0.28;
      const vMinWidth = 3e-3 + sigmoid(raw[12]) * 0.014;
      const vClusterBias = sigmoid(raw[13]) * 2.2;
      const vZBias = tanh(raw[14]) * 0.35;
      const vPaletteBias = tanh(raw[15]);
      const hDensity = 6e-3 + sigmoid(raw[16]) * 0.11;
      const hWidthMean = 0.45 + sigmoid(raw[17]) * 1.85;
      const hWidthJitter = 0.25 + sigmoid(raw[18]) * 1.75;
      const hSkipRate = sigmoid(raw[19]) * 0.28;
      const hMinWidth = 3e-3 + sigmoid(raw[20]) * 0.014;
      const hClusterBias = sigmoid(raw[21]) * 2.2;
      const hZBias = tanh(raw[22]) * 0.35;
      const hPaletteBias = tanh(raw[23]);
      const edgeExpand = Math.round(sigmoid(raw[24]) * 1);
      const familyBalance = sigmoid(raw[25]);
      const randomTempo = 0.035 + sigmoid(raw[26]) * 0.62;
      const randomPhaseBias = tanh(raw[27]) * 8;
      const randomPhaseWarp = sigmoid(raw[28]) * 22;
      const energies = [];
      let activeIndices = [];
      let maxEnergy = -Infinity;
      let maxIdx = 0;
      for (let i = 0; i < 32; i++) {
        const energy = raw[32 + i] / colorTemperature;
        energies.push(energy);
        if (energy > maxEnergy) {
          maxEnergy = energy;
          maxIdx = i;
        }
        if (energy > colorThreshold) activeIndices.push(i);
      }
      if (colorLimit > 0) {
        activeIndices = energies.map((e, idx) => ({ idx, e })).sort((a, b) => b.e - a.e).slice(0, requestedColorCount).map((x) => x.idx);
      } else {
        if (activeIndices.length === 0) activeIndices.push(maxIdx);
        if (activeIndices.length > requestedColorCount) {
          activeIndices = activeIndices.map((idx) => ({ idx, e: energies[idx] })).sort((a, b) => b.e - a.e).slice(0, requestedColorCount).map((x) => x.idx);
        }
      }
      if (manualPaletteIndices.length > 0) {
        activeIndices = manualPaletteIndices.slice();
      }
      return {
        paletteIndices: activeIndices,
        energies,
        colorThreshold,
        colorTemperature,
        activeColorCap: requestedColorCount,
        stepMod,
        zSpread,
        globalZBias,
        accentBias,
        whitespaceBias,
        vDensity,
        vWidthMean,
        vWidthJitter,
        vSkipRate,
        vMinWidth,
        vClusterBias,
        vZBias,
        vPaletteBias,
        hDensity,
        hWidthMean,
        hWidthJitter,
        hSkipRate,
        hMinWidth,
        hClusterBias,
        hZBias,
        hPaletteBias,
        edgeExpand,
        familyBalance,
        randomTempo,
        randomPhaseBias,
        randomPhaseWarp,
        _forwardState: forwardState
      };
    }
  };

  // src/js/colorPicker.js
  function createStableSampler(scope, params, renderGeneration, universeSeed, randomnessLevel) {
    const tempo = params ? params.randomTempo : 0.34;
    const phaseBias = params ? params.randomPhaseBias : 0;
    const phaseWarp = params ? params.randomPhaseWarp : 0;
    const rate = randomnessLevel <= 0 ? 0 : Math.pow(randomnessLevel, 1.35) * tempo;
    const curved = renderGeneration + Math.sin(renderGeneration * 0.013 + phaseBias) * phaseWarp;
    const phase = rate <= 0 ? 0 : Math.floor(curved * rate + phaseBias * 11);
    return (salt) => unitFromHash(hashString(`${universeSeed}:${scope}:${phase}:${salt}`));
  }
  function buildFamilyWeights(indices, energies, familyBias) {
    const exponent = familyBias >= 0 ? 1 + familyBias * 1.8 : 1 + familyBias * 0.6;
    const weights = indices.map((idx) => {
      const e = Math.max(energies[idx], -4);
      return Math.pow(sigmoid(e * 1.4) + 1e-3, exponent);
    });
    let total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) total = 1;
    return { weights, total };
  }
  function pickWeightedIndex(indices, familyWeightInfo, accentBias, randomUnit = Math.random) {
    const { weights, total } = familyWeightInfo;
    if (randomUnit() < accentBias) return indices[0];
    let r = randomUnit() * total;
    for (let i = 0; i < indices.length; i++) {
      r -= weights[i];
      if (r <= 0) return indices[i];
    }
    return indices[indices.length - 1];
  }
  function createColorPicker(paletteColors, indices, energies, familyBias, accentBias, sampler = null) {
    const sorted = [...indices].sort((a, b) => energies[b] - energies[a]);
    const familyWeightInfo = buildFamilyWeights(sorted, energies, familyBias);
    return function pickColor(salt = "color") {
      const randomUnit = sampler ? () => sampler(salt) : Math.random;
      const idx = pickWeightedIndex(sorted, familyWeightInfo, accentBias, randomUnit);
      return paletteColors[idx] ?? "#000000";
    };
  }

  // src/js/latentMap.js
  var latentProjector = { x: null, y: null };
  var latentTrail = [];
  var latentMapViewport = { scale: 1, maxAbs: 1 };
  function normalizeVector(vec) {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  }
  function initLatentProjector() {
    latentProjector.x = new Float32Array(LATENT_DIM);
    latentProjector.y = new Float32Array(LATENT_DIM);
    for (let i = 0; i < LATENT_DIM; i++) {
      latentProjector.x[i] = randNormal();
      latentProjector.y[i] = randNormal();
    }
    normalizeVector(latentProjector.x);
    normalizeVector(latentProjector.y);
    latentTrail.length = 0;
  }
  function projectLatentTo2D(z) {
    if (!latentProjector.x || !latentProjector.y) return { x: 0, y: 0 };
    let px = 0, py = 0;
    for (let i = 0; i < z.length; i++) {
      px += z[i] * latentProjector.x[i];
      py += z[i] * latentProjector.y[i];
    }
    return { x: px, y: py };
  }
  function pushLatentTrail(point) {
    const prev = latentTrail[latentTrail.length - 1];
    const speed = prev ? Math.hypot(point.x - prev.x, point.y - prev.y) : 0;
    latentTrail.push({ x: point.x, y: point.y, speed });
    if (latentTrail.length > MAX_TRAIL_POINTS) latentTrail.shift();
    return speed;
  }
  function drawLatentMap(canvas, currentPoint) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    let maxAbs = 1;
    for (const p of latentTrail) maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
    const scale = 0.42 * Math.min(w, h) / maxAbs;
    latentMapViewport.scale = scale;
    latentMapViewport.maxAbs = maxAbs;
    const mapX = (x) => w / 2 + x * scale;
    const mapY = (y) => h / 2 - y * scale;
    if (latentTrail.length > 1) {
      let maxSpeed = 1e-6;
      for (const p of latentTrail) maxSpeed = Math.max(maxSpeed, p.speed || 0);
      ctx.lineWidth = 2;
      for (let i = 1; i < latentTrail.length; i++) {
        const a = latentTrail[i - 1], b = latentTrail[i];
        const speedT = clamp((b.speed || 0) / maxSpeed, 0, 1);
        ctx.beginPath();
        ctx.moveTo(mapX(a.x), mapY(a.y));
        ctx.lineTo(mapX(b.x), mapY(b.y));
        ctx.strokeStyle = scientificColor(speedT, 0.78);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(mapX(currentPoint.x), mapY(currentPoint.y), 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mapX(currentPoint.x), mapY(currentPoint.y), 7, 0, Math.PI * 2);
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  function drawDecoderView(canvas, forwardState, previousDecoderState) {
    if (!canvas || !forwardState) return previousDecoderState;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(0, 0, w, h);
    const panelCell = 6, panelY = 48;
    const prev = previousDecoderState;
    const layers = [
      { label: "Z", dim: LATENT_DIM, values: forwardState.latent, prev: prev?.latent, cols: 12, rows: 16, x: 16 },
      { label: "H1", dim: HIDDEN_1, values: forwardState.h1, prev: prev?.h1, cols: 12, rows: 8, x: 116 },
      { label: "H2", dim: HIDDEN_2, values: forwardState.h2, prev: prev?.h2, cols: 8, rows: 8, x: 216 },
      { label: "OUT", dim: OUT_DIM, values: forwardState.out, prev: prev?.out, cols: 8, rows: 8, x: 316 }
    ];
    for (const layer of layers) {
      ctx.fillStyle = "#9ca3af";
      ctx.font = "10px monospace";
      ctx.fillText(`${layer.label} ${layer.dim}`, layer.x, 20);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.strokeRect(layer.x - 1, panelY - 1, layer.cols * panelCell + 1, layer.rows * panelCell + 1);
      let m = 1e-6;
      for (const v of layer.values) m = Math.max(m, Math.abs(v));
      let maxDelta = 1e-6;
      if (layer.prev)
        for (let i = 0; i < layer.values.length; i++)
          maxDelta = Math.max(maxDelta, Math.abs(layer.values[i] - layer.prev[i]));
      for (let i = 0; i < layer.cols * layer.rows; i++) {
        if (i >= layer.values.length) continue;
        const v = layer.values[i];
        const signed = clamp(v / m, -1, 1);
        const delta = layer.prev ? Math.abs(v - layer.prev[i]) / maxDelta : 0;
        const colorT = clamp((signed + 1) / 2 + delta * 0.16, 0, 1);
        const alpha = 0.76 + delta * 0.24;
        ctx.fillStyle = scientificColor(colorT, alpha);
        ctx.fillRect(
          layer.x + i % layer.cols * panelCell,
          panelY + Math.floor(i / layer.cols) * panelCell,
          panelCell - 1,
          panelCell - 1
        );
      }
    }
    return {
      latent: new Float32Array(forwardState.latent),
      h1: new Float32Array(forwardState.h1),
      h2: new Float32Array(forwardState.h2),
      out: new Float32Array(forwardState.out)
    };
  }

  // src/js/renderer.js
  function updateText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  }
  function syncPaletteSwatchHighlight() {
    const container = document.getElementById("palette-swatches");
    if (!container) return;
    const selected = new Set(AppState.manualPaletteIndices);
    const active = new Set(AppState.lastActivePaletteIndices);
    const hasManual = AppState.manualPaletteIndices.length > 0;
    for (const swatch of container.querySelectorAll(".palette-swatch")) {
      const idx = Number(swatch.dataset.index);
      swatch.classList.toggle("manual", selected.has(idx));
      swatch.classList.toggle("active", hasManual ? selected.has(idx) : active.has(idx));
    }
    document.getElementById("palette-auto-btn")?.classList.toggle("active", !hasManual);
    document.getElementById("palette-manual-btn")?.classList.toggle("active", hasManual);
  }
  function drawArt(canvas, entity, options = {}) {
    if (!canvas || !entity || !AppState.universeDecoder) return;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const w = canvas.width;
    const h = canvas.height;
    const updatePanels = options.updatePanels !== false;
    const renderGen = Number.isFinite(options.generationCount) ? options.generationCount : AppState.generationCount;
    const params = entity.getPhysicalParams(
      AppState.universeDecoder,
      AppState.activationMode,
      { colorLimit: AppState.colorLimit, manualPaletteIndices: AppState.manualPaletteIndices }
    );
    if (updatePanels) {
      AppState.lastParams = params;
      AppState.lastForwardState = params._forwardState;
      AppState.lastActivePaletteIndices = params.paletteIndices.slice();
      syncPaletteSwatchHighlight();
      const pt = projectLatentTo2D(entity.z);
      AppState.lastLatentSpeed = pushLatentTrail(pt);
      drawLatentMap(document.getElementById("latent-map-canvas"), pt);
      AppState.previousDecoderState = drawDecoderView(
        document.getElementById("decoder-canvas"),
        AppState.lastForwardState,
        AppState.previousDecoderState
      );
    }
    const paletteColors = getActivePalette().colors;
    const vSampler = createStableSampler("vertical", params, renderGen, AppState.universeSeed, AppState.randomnessLevel);
    const hSampler = createStableSampler("horizontal", params, renderGen, AppState.universeSeed, AppState.randomnessLevel);
    const vPickColor = createColorPicker(paletteColors, params.paletteIndices, params.energies, params.vPaletteBias, params.accentBias, (s) => vSampler(`palette:${s}`));
    const hPickColor = createColorPicker(paletteColors, params.paletteIndices, params.energies, params.hPaletteBias, params.accentBias, (s) => hSampler(`palette:${s}`));
    const renderer = getActiveRenderer();
    renderer.render(ctx, {
      params,
      axisMode: AppState.axisMode,
      layerMode: AppState.layerMode,
      vSampler,
      hSampler,
      vPickColor,
      hPickColor,
      paletteColors
    });
    if (updatePanels) {
      const isRadial = getActiveRendererName() === "radial";
      updateText("param-colors", params.paletteIndices.length);
      updateText("param-step", params.stepMod.toFixed(3));
      updateText("param-vdens", params.vDensity.toFixed(3));
      updateText("param-hdens", params.hDensity.toFixed(3));
      updateText("param-vskip", params.vSkipRate.toFixed(2));
      updateText("param-hskip", params.hSkipRate.toFixed(2));
      updateText("param-z", params.zSpread.toFixed(2));
      updateText("param-random", AppState.randomnessLevel.toFixed(2));
      updateText("param-form", renderer.label);
      updateText("param-layer", getLayerLabel(AppState.layerMode, isRadial));
      updateText("param-activation", getActivationLabel(AppState.activationMode));
      updateText("param-axis", AppState.axisMode === "both" ? "XY" : AppState.axisMode.toUpperCase());
      updateText("param-speed", AppState.lastLatentSpeed.toFixed(2));
    }
  }
  function getCanvas() {
    return document.getElementById("main-canvas");
  }

  // src/js/state.js
  function serializeArr(arr) {
    return Array.from(arr, (v) => Number(v.toFixed(6)));
  }
  function loadArr(target, source) {
    if (Array.isArray(source) && source.length === target.length) {
      target.set(source);
      return true;
    }
    return false;
  }
  function serializeDecoder(decoder) {
    if (!decoder) return null;
    return {
      w1: serializeArr(decoder.w1),
      b1: serializeArr(decoder.b1),
      w2: serializeArr(decoder.w2),
      b2: serializeArr(decoder.b2),
      w3: serializeArr(decoder.w3),
      b3: serializeArr(decoder.b3)
    };
  }
  function restoreDecoder(data) {
    const d = new DecoderNetwork();
    if (!data) return d;
    loadArr(d.w1, data.w1);
    loadArr(d.b1, data.b1);
    loadArr(d.w2, data.w2);
    loadArr(d.b2, data.b2);
    loadArr(d.w3, data.w3);
    loadArr(d.b3, data.b3);
    return d;
  }
  function serializeEntity(entity) {
    if (!entity) return null;
    return { z: serializeArr(entity.z), velocity: serializeArr(entity.velocity) };
  }
  function restoreEntity(data) {
    const e = new LatentEntity();
    if (!data) return e;
    loadArr(e.z, data.z);
    loadArr(e.velocity, data.velocity);
    return e;
  }
  function saveState() {
    if (!window.localStorage || !AppState.currentEntity || !AppState.universeDecoder) return;
    try {
      const payload = {
        version: 4,
        universeSeed: AppState.universeSeed,
        generationCount: AppState.generationCount,
        colorLimit: AppState.colorLimit,
        randomnessLevel: AppState.randomnessLevel,
        axisMode: AppState.axisMode,
        rendererName: getActiveRendererName(),
        layerMode: AppState.layerMode,
        activationMode: AppState.activationMode,
        activePaletteName: getActivePaletteName(),
        manualPaletteIndices: AppState.manualPaletteIndices,
        currentLanguage: AppState.currentLanguage,
        wallpaperRandomMode: AppState.wallpaperRandomMode,
        wallpaperDisplayMode: AppState.wallpaperDisplayMode,
        wallpaperSwitchSeconds: AppState.wallpaperSwitchSeconds,
        wallpaperOuterColor: AppState.wallpaperOuterColor,
        entity: serializeEntity(AppState.currentEntity),
        decoder: serializeDecoder(AppState.universeDecoder)
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("[State] Save skipped:", err.message);
    }
  }
  function restoreSavedState() {
    if (!window.localStorage) return false;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || ![3, 4].includes(s.version)) return false;
      AppState.universeSeed = Number.isFinite(s.universeSeed) ? s.universeSeed >>> 0 : createUniverseSeed();
      AppState.universeDecoder = restoreDecoder(s.decoder);
      AppState.currentEntity = restoreEntity(s.entity);
      AppState.generationCount = Number.isFinite(s.generationCount) ? Math.max(0, Math.floor(s.generationCount)) : 0;
      AppState.colorLimit = Number.isFinite(s.colorLimit) ? clamp(Math.floor(s.colorLimit), 0, 32) : 0;
      AppState.randomnessLevel = Number.isFinite(s.randomnessLevel) ? clamp(s.randomnessLevel, 0, 1) : 0.4;
      AppState.axisMode = ["both", "x", "y"].includes(s.axisMode) ? s.axisMode : "both";
      AppState.layerMode = ["auto", "xTop", "yTop"].includes(s.layerMode) ? s.layerMode : "auto";
      AppState.activationMode = ["relu", "leaky", "tanh", "swish"].includes(s.activationMode) ? s.activationMode : "relu";
      AppState.currentLanguage = s.currentLanguage === "zh" ? "zh" : "en";
      AppState.wallpaperRandomMode = ["growth", "universe"].includes(s.wallpaperRandomMode) ? s.wallpaperRandomMode : "growth";
      AppState.wallpaperDisplayMode = ["fill", "square"].includes(s.wallpaperDisplayMode) ? s.wallpaperDisplayMode : "square";
      AppState.wallpaperSwitchSeconds = Number.isFinite(s.wallpaperSwitchSeconds) ? clamp(Math.round(s.wallpaperSwitchSeconds * 10) / 10, 0.1, 3600) : 1;
      AppState.wallpaperOuterColor = /^#[0-9a-f]{6}$/i.test(s.wallpaperOuterColor || "") ? s.wallpaperOuterColor : "#ffffff";
      AppState.manualPaletteIndices = Array.isArray(s.manualPaletteIndices) ? s.manualPaletteIndices.map((x) => Math.floor(x)).filter((x) => x >= 0 && x < 32) : [];
      AppState.lastPersistFrame = AppState.generationCount;
      const rawRenderer = s.rendererName || s.geometryMode || "linear";
      const availR = listRenderers();
      setActiveRendererName(availR.includes(rawRenderer) ? rawRenderer : "linear");
      const rawPalette = s.activePaletteName || "classic";
      const availP = listPalettes();
      setActivePaletteName(availP.includes(rawPalette) ? rawPalette : "classic");
      return true;
    } catch (err) {
      console.warn("[State] Restore skipped:", err.message);
      return false;
    }
  }
  function snapshotRuntimeState() {
    return {
      universeSeed: AppState.universeSeed,
      universeDecoder: AppState.universeDecoder,
      currentEntity: AppState.currentEntity,
      generationCount: AppState.generationCount,
      colorLimit: AppState.colorLimit,
      randomnessLevel: AppState.randomnessLevel,
      manualPaletteIndices: AppState.manualPaletteIndices.slice(),
      lastActivePaletteIndices: AppState.lastActivePaletteIndices.slice(),
      lastParams: AppState.lastParams,
      lastForwardState: AppState.lastForwardState,
      previousDecoderState: AppState.previousDecoderState,
      lastLatentSpeed: AppState.lastLatentSpeed,
      latentTrailCopy: latentTrail.map((p) => ({ ...p }))
    };
  }
  function restoreRuntimeState(snap) {
    if (!snap) return;
    AppState.universeSeed = snap.universeSeed;
    AppState.universeDecoder = snap.universeDecoder;
    AppState.currentEntity = snap.currentEntity;
    AppState.generationCount = snap.generationCount;
    AppState.colorLimit = snap.colorLimit;
    AppState.randomnessLevel = snap.randomnessLevel;
    AppState.manualPaletteIndices = snap.manualPaletteIndices;
    AppState.lastActivePaletteIndices = snap.lastActivePaletteIndices;
    AppState.lastParams = snap.lastParams;
    AppState.lastForwardState = snap.lastForwardState;
    AppState.previousDecoderState = snap.previousDecoderState;
    AppState.lastLatentSpeed = snap.lastLatentSpeed;
    latentTrail.length = 0;
    latentTrail.push(...snap.latentTrailCopy || []);
  }

  // src/js/ui.js
  function updateText2(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  }
  var UI_TEXT = {
    en: {
      pause: "PAUSE",
      resume: "RESUME",
      reset: "REBOOT UNIVERSE",
      jump: "LATENT JUMP",
      save: "SAVE PNG",
      language: "\u4E2D\u6587",
      colors: "COLORS",
      random: "RANDOM",
      palette: "PALETTE",
      auto: "AUTO",
      latentMap: "LATENT MAP",
      decoderView: "DECODER VIEW"
    },
    zh: {
      pause: "\u6682\u505C",
      resume: "\u7EE7\u7EED",
      reset: "\u91CD\u542F\u5B87\u5B99",
      jump: "\u9690\u7A7A\u95F4\u8DF3\u8DC3",
      save: "\u4FDD\u5B58 PNG",
      language: "EN",
      colors: "\u989C\u8272",
      random: "\u968F\u673A",
      palette: "\u8272\u677F",
      auto: "\u81EA\u52A8",
      latentMap: "\u9690\u7A7A\u95F4\u56FE",
      decoderView: "\u89E3\u7801\u5668\u89C6\u56FE"
    }
  };
  var t = (key) => UI_TEXT[AppState.currentLanguage]?.[key] ?? UI_TEXT.en[key] ?? key;
  function applyLanguage() {
    updateText2("reset-btn", t("reset"));
    const wallpaperResetButton = document.getElementById("reset-btn");
    if (wallpaperResetButton && wallpaperResetButton.parentElement?.id === "settings-panel") wallpaperResetButton.innerText = "\u91CD\u542F\u5B87\u5B99";
    updateText2("jump-btn", t("jump"));
    updateText2("save-btn", t("save"));
    updateText2("record-btn", "RECORD ZIP");
    updateText2("universe-batch-btn", "100 UNIVERSES");
    updateText2("lang-btn", t("language"));
    updateText2("palette-label", t("palette"));
    updateText2("palette-auto-btn", t("auto"));
    const labels = {
      "frames-label": "FRAMES ",
      "interval-label": "EVERY ",
      "size-label": "SIZE ",
      "color-label": `${t("colors")} `,
      "random-label": `${t("random")} `
    };
    for (const [id, text] of Object.entries(labels)) {
      const el = document.getElementById(id);
      if (el && el.firstChild) el.firstChild.nodeValue = text;
    }
    const titles = document.querySelectorAll(".viz-title");
    if (titles[0]) titles[0].innerText = t("latentMap");
    if (titles[1]) titles[1].innerText = t("decoderView");
    setPausedVisual(AppState.isPaused);
    syncControlUI();
  }
  function toggleLanguage() {
    AppState.currentLanguage = AppState.currentLanguage === "en" ? "zh" : "en";
    applyLanguage();
    saveState();
  }
  function setPausedVisual(paused) {
    const btn = document.getElementById("pause-btn");
    const indicator = document.querySelector(".status-indicator");
    if (btn) {
      const isStudio = document.body.classList.contains("studio-view");
      btn.textContent = isStudio ? paused ? "RESUME" : "PAUSE" : String.fromCodePoint(paused ? 9654 : 9208);
      btn.setAttribute("aria-label", isStudio ? paused ? "RESUME" : "PAUSE" : paused ? "\u7EE7\u7EED\u64AD\u653E" : "\u6682\u505C");
    }
    if (paused) {
      if (btn) {
        btn.style.color = "#ef4444";
        btn.style.borderColor = "#ef4444";
      }
      if (indicator) {
        indicator.style.backgroundColor = "#ef4444";
        indicator.style.boxShadow = "0 0 10px #ef4444";
      }
    } else {
      if (btn) {
        btn.style.color = "#d1d5db";
        btn.style.borderColor = "rgba(255, 255, 255, 0.2)";
      }
      if (indicator) {
        indicator.style.backgroundColor = "#10b981";
        indicator.style.boxShadow = "0 0 10px #10b981";
      }
    }
  }
  function setStudioView(enabled, shouldSave = true) {
    document.body.classList.toggle("studio-view", enabled);
    const studioButton = document.getElementById("studio-btn");
    const settingsPanel = document.getElementById("settings-panel");
    const controls = document.querySelector(".controls");
    const resetButton = document.getElementById("reset-btn");
    const pauseButton = document.getElementById("pause-btn");
    const colorSlot = document.getElementById("wallpaper-color-slot");
    const colorPanel = document.querySelector(".palette-panel");
    const colorRow = document.getElementById("color-label");
    if (studioButton) {
      studioButton.setAttribute("aria-label", enabled ? "\u8FD4\u56DE\u58C1\u7EB8" : "\u539F\u7248\u5DE5\u4F5C\u53F0");
      studioButton.textContent = enabled ? "BACK" : "\u2605";
    }
    if (settingsPanel) settingsPanel.classList.remove("open");
    if (enabled && controls && resetButton && pauseButton) {
      controls.insertBefore(resetButton, pauseButton);
      resetButton.innerText = "REBOOT UNIVERSE";
      if (colorPanel) controls.appendChild(colorPanel);
      if (colorRow) controls.appendChild(colorRow);
      pauseButton.innerText = AppState.isPaused ? "RESUME" : "PAUSE";
      pauseButton.setAttribute("aria-label", AppState.isPaused ? "RESUME" : "PAUSE");
    } else if (!enabled && settingsPanel && resetButton) {
      settingsPanel.appendChild(resetButton);
      resetButton.innerText = "\u91CD\u542F\u5B87\u5B99";
      if (colorSlot && colorPanel) colorSlot.appendChild(colorPanel);
      if (colorSlot && colorRow) colorSlot.appendChild(colorRow);
      setPausedVisual(AppState.isPaused);
    }
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    if (shouldSave) saveState();
  }
  function initMatrixUI() {
    const container = document.getElementById("matrix-container");
    if (!container) return;
    container.innerHTML = "";
    for (let i = 0; i < LATENT_DIM; i++) {
      const cell = document.createElement("div");
      cell.className = "latent-cell";
      cell.id = `cell-${i}`;
      container.appendChild(cell);
    }
  }
  function updateMatrixUI(entity) {
    if (!entity) return;
    for (let i = 0; i < LATENT_DIM; i++) {
      const cell = document.getElementById(`cell-${i}`);
      if (!cell) continue;
      const val = entity.z[i];
      const normalized = clamp((val + 5.5) / 11, 0, 1);
      if (val > 1) cell.style.backgroundColor = `rgba(16,185,129,${normalized})`;
      else if (val < -1) cell.style.backgroundColor = `rgba(239,68,68,${1 - normalized})`;
      else cell.style.backgroundColor = `rgba(255,255,255,${normalized * 0.22})`;
    }
  }
  function initPaletteSwatches(onSwatchClick) {
    const container = document.getElementById("palette-swatches");
    if (!container) return;
    _rebuildSwatches(container, onSwatchClick);
  }
  function rebuildPaletteSwatches(onSwatchClick) {
    initPaletteSwatches(onSwatchClick);
  }
  function _rebuildSwatches(container, onSwatchClick) {
    container.innerHTML = "";
    getActivePalette().colors.forEach((color, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-swatch";
      btn.style.backgroundColor = color;
      btn.title = `${idx + 1}: ${color}`;
      btn.dataset.index = String(idx);
      btn.addEventListener("click", () => onSwatchClick(idx));
      container.appendChild(btn);
    });
    updatePaletteUI();
  }
  function updatePaletteUI() {
    const container = document.getElementById("palette-swatches");
    if (!container) return;
    const selected = new Set(AppState.manualPaletteIndices);
    const active = new Set(AppState.lastActivePaletteIndices);
    const hasManual = AppState.manualPaletteIndices.length > 0;
    for (const swatch of container.querySelectorAll(".palette-swatch")) {
      const idx = Number(swatch.dataset.index);
      swatch.classList.toggle("manual", selected.has(idx));
      swatch.classList.toggle("active", hasManual ? selected.has(idx) : active.has(idx));
    }
    document.getElementById("palette-auto-btn")?.classList.toggle("active", !hasManual);
    document.getElementById("palette-manual-btn")?.classList.toggle("active", hasManual);
  }
  function enableManualPalette() {
    if (AppState.manualPaletteIndices.length === 0) {
      AppState.manualPaletteIndices = AppState.lastActivePaletteIndices.length ? AppState.lastActivePaletteIndices.slice() : [0, 6, 12, 18];
    }
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function clearManualPalette() {
    AppState.manualPaletteIndices = [];
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function syncControlUI() {
    const colorInput = document.getElementById("color-count");
    if (colorInput) colorInput.value = String(AppState.colorLimit);
    const randomInput = document.getElementById("randomness");
    const randomValue = Math.round(AppState.randomnessLevel * 100);
    if (randomInput) randomInput.value = String(randomValue);
    updateText2("color-count-value", AppState.colorLimit === 0 ? "AUTO" : AppState.colorLimit);
    updateText2("param-color-limit", AppState.colorLimit === 0 ? "AUTO" : AppState.colorLimit);
    updateText2("randomness-value", randomValue);
    updateText2("param-random", AppState.randomnessLevel.toFixed(2));
    const rendererName = getActiveRendererName();
    const isRadial = rendererName === "radial";
    updateText2("param-form", getRenderer(rendererName)?.label ?? "\u2014");
    updateText2("param-layer", getLayerLabel(AppState.layerMode, isRadial));
    updateText2("param-activation", getActivationLabel(AppState.activationMode));
    updateText2("param-axis", AppState.axisMode === "both" ? "XY" : AppState.axisMode.toUpperCase());
    updatePaletteUI();
    _syncButtonGroup({ "form-linear-btn": "linear", "form-radial-btn": "radial" }, rendererName);
    _syncButtonGroup({ "layer-auto-btn": "auto", "layer-x-btn": "xTop", "layer-y-btn": "yTop" }, AppState.layerMode);
    _syncButtonGroup({ "act-relu-btn": "relu", "act-leaky-btn": "leaky", "act-tanh-btn": "tanh", "act-swish-btn": "swish" }, AppState.activationMode);
    _syncButtonGroup({ "axis-both-btn": "both", "axis-x-btn": "x", "axis-y-btn": "y" }, AppState.axisMode);
    updateText2("layer-x-btn", isRadial ? "SECTOR TOP" : "VERT TOP");
    updateText2("layer-y-btn", isRadial ? "RING TOP" : "HORIZ TOP");
    _syncRendererSlots(rendererName);
    _syncPaletteThemeSlots();
    updatePaletteUI();
    document.getElementById("fill-mode-btn")?.classList.toggle("active", AppState.wallpaperDisplayMode === "fill");
    document.getElementById("square-mode-btn")?.classList.toggle("active", AppState.wallpaperDisplayMode === "square");
    document.getElementById("growth-mode-btn")?.classList.toggle("active", AppState.wallpaperRandomMode === "growth");
    document.getElementById("universe-mode-btn")?.classList.toggle("active", AppState.wallpaperRandomMode === "universe");
  }
  function _syncButtonGroup(idToValueMap, activeValue) {
    for (const [id, val] of Object.entries(idToValueMap)) {
      document.getElementById(id)?.classList.toggle("active", val === activeValue);
    }
  }
  function _syncRendererSlots(activeRendererName) {
    const slot = document.getElementById("renderer-slot");
    if (!slot) return;
    for (const btn of slot.querySelectorAll("[data-renderer]")) {
      btn.classList.toggle("active", btn.dataset.renderer === activeRendererName);
    }
  }
  function _syncPaletteThemeSlots() {
    const currentPalette = getActivePaletteName();
    const slot = document.getElementById("palette-theme-slot");
    if (!slot) return;
    for (const btn of slot.querySelectorAll("[data-palette]")) {
      btn.classList.toggle("active", btn.dataset.palette === currentPalette);
    }
  }

  // src/js/wallpaper.js
  function applyWallpaperDisplay(redraw = true) {
    const frame = document.getElementById("art-frame") || document.querySelector(".art-frame");
    const canvas = getCanvas();
    if (!frame || !canvas) return;
    frame.id = "art-frame";
    frame.classList.toggle("square", AppState.wallpaperDisplayMode === "square");
    document.body.style.backgroundColor = AppState.wallpaperOuterColor;
    frame.style.setProperty("--outer-bg", AppState.wallpaperOuterColor);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const square = AppState.wallpaperDisplayMode === "square";
    const side = Math.max(480, Math.floor(Math.min(innerWidth, innerHeight) * 0.92 * dpr));
    canvas.width = square ? side : Math.max(720, Math.floor(innerWidth * dpr));
    canvas.height = square ? side : Math.max(480, Math.floor(innerHeight * dpr));
    document.getElementById("fill-mode-btn")?.classList.toggle("active", !square);
    document.getElementById("square-mode-btn")?.classList.toggle("active", square);
    const row = document.getElementById("outer-color-row");
    if (row) row.style.opacity = square ? "1" : ".45";
    if (redraw && AppState.currentEntity) drawArt(canvas, AppState.currentEntity);
  }
  function setWallpaperDisplayMode(mode) {
    if (!["fill", "square"].includes(mode)) return;
    AppState.wallpaperDisplayMode = mode;
    applyWallpaperDisplay();
    saveState();
  }
  function setWallpaperRandomMode(mode) {
    if (!["growth", "universe"].includes(mode)) return;
    AppState.wallpaperRandomMode = mode;
    AppState.lastWallpaperSwitch = performance.now();
    document.getElementById("growth-mode-btn")?.classList.toggle("active", mode === "growth");
    document.getElementById("universe-mode-btn")?.classList.toggle("active", mode === "universe");
    saveState();
  }
  function advanceWallpaper() {
    if (!AppState.currentEntity || !AppState.universeDecoder) return;
    if (AppState.wallpaperRandomMode === "universe") {
      AppState.universeSeed = createUniverseSeed();
      AppState.universeDecoder = new DecoderNetwork();
      AppState.currentEntity = new LatentEntity();
      latentTrail.length = 0;
      AppState.previousDecoderState = null;
    } else {
      const speed = (AppState.lastParams?.stepMod ?? 0.04) * Math.max(AppState.randomnessLevel, 0.2);
      AppState.currentEntity.step(speed);
    }
    AppState.generationCount++;
  }
  function nextWallpaper() {
    if (!AppState.currentEntity || !AppState.universeDecoder) return;
    advanceWallpaper();
    AppState.lastWallpaperSwitch = performance.now();
    drawArt(getCanvas(), AppState.currentEntity);
    updateText2("gen-counter", AppState.generationCount);
    saveState();
  }

  // src/js/export.js
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
  }
  function canvasToPngBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }
  function getNumberInputValue(id, fallback, min, max) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = Number(el.value);
    if (!Number.isFinite(v)) return fallback;
    return clamp(Math.round(v), min, max);
  }
  async function exportMainCanvas() {
    if (!AppState.currentEntity || !AppState.universeDecoder) return;
    const outputSize = getNumberInputValue("sequence-size", 2400, 1200, 4096);
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = outputSize;
    exportCanvas.height = outputSize;
    drawArt(exportCanvas, AppState.currentEntity, {
      updatePanels: false,
      generationCount: AppState.generationCount
    });
    const blob = await canvasToPngBlob(exportCanvas);
    downloadBlob(blob, `latent-art-${String(AppState.generationCount).padStart(6, "0")}-${outputSize}px.png`);
  }
  var CRC_TABLE = (() => {
    const t2 = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      t2[n] = c;
    }
    return t2;
  })();
  function crc32(data) {
    let crc = 4294967295;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 255] ^ crc >>> 8;
    return (crc ^ 4294967295) >>> 0;
  }
  function u16(v) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, true);
    return b;
  }
  function u32(v) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return b;
  }
  function dosDateTime() {
    const d = /* @__PURE__ */ new Date();
    return {
      time: (d.getHours() << 11 | d.getMinutes() << 5 | Math.floor(d.getSeconds() / 2)) >>> 0,
      date: (d.getFullYear() - 1980 << 9 | d.getMonth() + 1 << 5 | d.getDate()) >>> 0
    };
  }
  function makeZipBlob(entries) {
    const localParts = [];
    const centralDir = [];
    let offset = 0;
    for (const { name, data } of entries) {
      const nameBytes = new TextEncoder().encode(name);
      const crc = crc32(data);
      const dt = dosDateTime();
      const local = new Uint8Array([
        80,
        75,
        3,
        4,
        20,
        0,
        0,
        0,
        0,
        0,
        ...u16(dt.time),
        ...u16(dt.date),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(nameBytes.length),
        ...u16(0),
        ...nameBytes,
        ...data
      ]);
      localParts.push(local);
      centralDir.push(new Uint8Array([
        80,
        75,
        1,
        2,
        20,
        0,
        20,
        0,
        0,
        0,
        0,
        0,
        ...u16(dt.time),
        ...u16(dt.date),
        ...u32(crc),
        ...u32(data.length),
        ...u32(data.length),
        ...u16(nameBytes.length),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u16(0),
        ...u32(0),
        ...u32(offset),
        ...nameBytes
      ]));
      offset += local.length;
    }
    const cdSize = centralDir.reduce((n, b) => n + b.length, 0);
    const eocd = new Uint8Array([
      80,
      75,
      5,
      6,
      0,
      0,
      0,
      0,
      ...u16(entries.length),
      ...u16(entries.length),
      ...u32(cdSize),
      ...u32(offset),
      ...u16(0)
    ]);
    const parts = [...localParts, ...centralDir, eocd];
    const total = parts.reduce((n, b) => n + b.length, 0);
    const zip = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
      zip.set(p, pos);
      pos += p.length;
    }
    return new Blob([zip], { type: "application/zip" });
  }
  function resetRecordButton(label = "RECORD ZIP") {
    const btn = document.getElementById("record-btn");
    if (btn) {
      btn.innerText = label;
      btn.classList.remove("recording");
    }
  }
  function updateRecordButton() {
    const recorder = AppState.sequenceRecorder;
    const btn = document.getElementById("record-btn");
    if (!btn) return;
    if (recorder && (recorder.active || recorder.pendingCaptures > 0)) {
      const total = recorder.targetFrames;
      const done = Math.min(recorder.entries.length + recorder.pendingCaptures, total);
      btn.innerText = `${done}/${total}`;
      btn.classList.add("recording");
    } else {
      btn.innerText = "RECORD ZIP";
      btn.classList.remove("recording");
    }
  }
  function toggleSequenceRecording() {
    if (AppState.isRecordingSequence) {
      stopSequenceRecording();
      return;
    }
    if (!AppState.currentEntity || !AppState.universeDecoder) return;
    const targetFrames = getNumberInputValue("sequence-frames", 240, 1, 1e3);
    const outputSize = getNumberInputValue("sequence-size", 2400, 1200, 4096);
    const interval = getNumberInputValue("sequence-interval", 1, 1, 100);
    AppState.sequenceRecorder = {
      active: true,
      targetFrames,
      outputSize,
      interval,
      entries: [],
      visibleFrameCount: 0,
      pendingCaptures: 0,
      startGeneration: AppState.generationCount,
      stopRequested: false,
      finishing: false
    };
    AppState.isRecordingSequence = true;
    updateRecordButton();
  }
  function stopSequenceRecording() {
    const recorder = AppState.sequenceRecorder;
    if (!recorder) return;
    recorder.stopRequested = true;
    recorder.active = false;
    updateRecordButton();
    finishSequenceRecordingIfReady();
  }
  function captureSequenceFrame(entity, renderGeneration) {
    const recorder = AppState.sequenceRecorder;
    if (!recorder || !recorder.active || recorder.stopRequested) return;
    if (recorder.entries.length + recorder.pendingCaptures >= recorder.targetFrames) {
      stopSequenceRecording();
      return;
    }
    recorder.visibleFrameCount++;
    if ((recorder.visibleFrameCount - 1) % recorder.interval !== 0) return;
    const frameNumber = recorder.entries.length + recorder.pendingCaptures + 1;
    const entitySnapshot = restoreEntity(serializeEntity(entity));
    recorder.pendingCaptures++;
    updateRecordButton();
    captureSequenceFrameAsync(recorder, entitySnapshot, renderGeneration, frameNumber);
  }
  async function captureSequenceFrameAsync(recorder, entitySnapshot, renderGeneration, frameNumber) {
    try {
      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = recorder.outputSize;
      captureCanvas.height = recorder.outputSize;
      drawArt(captureCanvas, entitySnapshot, {
        updatePanels: false,
        generationCount: renderGeneration
      });
      const blob = await canvasToPngBlob(captureCanvas);
      recorder.entries.push({
        name: `latent-art-frame-${String(frameNumber).padStart(6, "0")}.png`,
        data: new Uint8Array(await blob.arrayBuffer())
      });
    } catch (err) {
      console.error("[Sequence export] Frame capture failed:", err);
      recorder.stopRequested = true;
      recorder.active = false;
    } finally {
      recorder.pendingCaptures--;
      if (recorder.entries.length >= recorder.targetFrames) {
        recorder.stopRequested = true;
        recorder.active = false;
      }
      updateRecordButton();
      finishSequenceRecordingIfReady();
    }
  }
  function finishSequenceRecordingIfReady() {
    const recorder = AppState.sequenceRecorder;
    if (!recorder || recorder.finishing) return;
    if (!recorder.stopRequested || recorder.pendingCaptures > 0) return;
    recorder.finishing = true;
    const entries = recorder.entries.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > 0) {
      const zip = makeZipBlob(entries);
      const filename = `latent-art-sequence-gen-${String(recorder.startGeneration).padStart(6, "0")}-${recorder.outputSize}px-${entries.length}f-step${recorder.interval}.zip`;
      downloadBlob(zip, filename);
      resetRecordButton("RECORD ZIP");
    } else {
      resetRecordButton("NO FRAMES");
      setTimeout(() => resetRecordButton(), 900);
    }
    AppState.isRecordingSequence = false;
    AppState.sequenceRecorder = null;
  }
  async function exportUniverseBatchZip() {
    if (AppState.isRecordingUniverseBatch || AppState.isRecordingSequence) return;
    const button = document.getElementById("universe-batch-btn");
    const outputSize = getNumberInputValue("sequence-size", 2400, 1200, 4096);
    const captureCanvas = document.createElement("canvas");
    const entries = [];
    const snapshot = snapshotRuntimeState();
    captureCanvas.width = outputSize;
    captureCanvas.height = outputSize;
    AppState.isRecordingUniverseBatch = true;
    if (button) {
      button.disabled = true;
      button.innerText = "UNI 0/100";
    }
    try {
      for (let i = 0; i < 100; i++) {
        AppState.universeSeed = createUniverseSeed();
        AppState.universeDecoder = new DecoderNetwork();
        AppState.currentEntity = new LatentEntity();
        AppState.generationCount = 0;
        AppState.colorLimit = 0;
        AppState.manualPaletteIndices = [];
        randomizeRuntimeControls();
        drawArt(captureCanvas, AppState.currentEntity, {
          updatePanels: false,
          generationCount: i
        });
        const blob = await canvasToPngBlob(captureCanvas);
        entries.push({
          name: `latent-universe-${String(i + 1).padStart(6, "0")}.png`,
          data: new Uint8Array(await blob.arrayBuffer())
        });
        if (button) button.innerText = `UNI ${i + 1}/100`;
        if (i % 5 === 4) await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      const zip = makeZipBlob(entries);
      downloadBlob(zip, `latent-universe-batch-${outputSize}px-100.zip`);
    } catch (err) {
      console.error("[Universe batch export] Failed:", err);
      if (button) button.innerText = "BATCH FAILED";
    } finally {
      restoreRuntimeState(snapshot);
      AppState.isRecordingUniverseBatch = false;
      syncControlUI();
      updateText2("gen-counter", AppState.generationCount);
      updateMatrixUI(AppState.currentEntity);
      drawArt(getCanvas(), AppState.currentEntity);
      if (button) {
        setTimeout(() => {
          button.disabled = false;
          button.innerText = "100 UNIVERSES";
        }, 800);
      }
    }
  }

  // src/js/controls.js
  function setColorLimit(value) {
    AppState.colorLimit = clamp(Math.floor(Number(value) || 0), 0, 32);
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function setRandomness(value) {
    AppState.randomnessLevel = clamp((Number(value) || 0) / 100, 0, 1);
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function setAxisMode(mode) {
    if (!["both", "x", "y"].includes(mode)) return;
    AppState.axisMode = mode;
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function setGeometryMode(name) {
    if (!listRenderers().includes(name)) return;
    setActiveRendererName(name);
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function setLayerMode(mode) {
    if (!["auto", "xTop", "yTop"].includes(mode)) return;
    AppState.layerMode = mode;
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function setActivationMode(mode) {
    if (!["relu", "leaky", "tanh", "swish"].includes(mode)) return;
    AppState.activationMode = mode;
    AppState.previousDecoderState = null;
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function setPalette(name) {
    if (!listPalettes().includes(name)) return;
    setActivePaletteName(name);
    rebuildPaletteSwatches(handleSwatchClick);
    syncControlUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function handleSwatchClick(idx) {
    const set = new Set(AppState.manualPaletteIndices);
    if (set.has(idx)) set.delete(idx);
    else set.add(idx);
    AppState.manualPaletteIndices = [...set].sort((a, b) => a - b);
    updatePaletteUI();
    if (AppState.currentEntity) drawArt(getCanvas(), AppState.currentEntity);
    saveState();
  }
  function buildRendererSlots(onRendererChange) {
    const slot = document.getElementById("renderer-slot");
    if (!slot) return;
    slot.innerHTML = "";
    for (const name of listRenderers()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "action-btn";
      btn.dataset.renderer = name;
      btn.textContent = getRenderer(name).label;
      btn.addEventListener("click", () => onRendererChange(name));
      slot.appendChild(btn);
    }
  }
  function buildPaletteThemeSlots(onPaletteChange) {
    const slot = document.getElementById("palette-theme-slot");
    if (!slot) return;
    slot.innerHTML = "";
    for (const name of listPalettes()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "action-btn";
      btn.dataset.palette = name;
      btn.textContent = getPalette(name).label;
      btn.addEventListener("click", () => onPaletteChange(name));
      slot.appendChild(btn);
    }
  }
  function jumpToLatentMap(event) {
    if (!AppState.currentEntity || !latentProjector.x || !latentProjector.y) return;
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    const scale = latentMapViewport.scale || 1;
    const targetX = (x - canvas.width / 2) / scale;
    const targetY = (canvas.height / 2 - y) / scale;
    const current = projectLatentTo2D(AppState.currentEntity.z);
    const dx = clamp(targetX - current.x, -3, 3);
    const dy = clamp(targetY - current.y, -3, 3);
    for (let i = 0; i < LATENT_DIM; i++) {
      AppState.currentEntity.z[i] += latentProjector.x[i] * dx + latentProjector.y[i] * dy;
      AppState.currentEntity.velocity[i] *= 0.25;
    }
    AppState.generationCount++;
    drawArt(getCanvas(), AppState.currentEntity);
    updateText2("gen-counter", AppState.generationCount);
    updateMatrixUI(AppState.currentEntity);
    saveState();
  }
  function bindControls(actions) {
    const { togglePause: togglePause2, hardReset: hardReset2, jumpLatentRegion: jumpLatentRegion2, nextWallpaper: nextWallpaper2 } = actions;
    const canvas = getCanvas();
    buildRendererSlots((name) => setGeometryMode(name));
    buildPaletteThemeSlots((name) => setPalette(name));
    initPaletteSwatches(handleSwatchClick);
    const settingsBtn = document.getElementById("settings-btn");
    const settingsPanel = document.getElementById("settings-panel");
    if (settingsBtn && settingsPanel) settingsBtn.addEventListener("click", () => settingsPanel.classList.toggle("open"));
    const nextBtn = document.getElementById("next-btn");
    if (nextBtn) {
      nextBtn.setAttribute("aria-label", "Next");
      nextBtn.textContent = String.fromCodePoint(9197);
      nextBtn.addEventListener("click", nextWallpaper2);
    }
    const studioBtn = document.getElementById("studio-btn");
    if (studioBtn) studioBtn.addEventListener("click", () => setStudioView(!document.body.classList.contains("studio-view")));
    const resetBtn = document.getElementById("reset-btn");
    if (resetBtn && settingsPanel) {
      resetBtn.textContent = "\u91CD\u542F\u5B87\u5B99";
      settingsPanel.appendChild(resetBtn);
    }
    document.getElementById("growth-mode-btn")?.addEventListener("click", () => setWallpaperRandomMode("growth"));
    document.getElementById("universe-mode-btn")?.addEventListener("click", () => setWallpaperRandomMode("universe"));
    document.getElementById("fill-mode-btn")?.addEventListener("click", () => setWallpaperDisplayMode("fill"));
    document.getElementById("square-mode-btn")?.addEventListener("click", () => setWallpaperDisplayMode("square"));
    document.getElementById("outer-color")?.addEventListener("input", (event) => {
      AppState.wallpaperOuterColor = event.target.value;
      applyWallpaperDisplay(false);
      saveState();
    });
    document.getElementById("switch-seconds")?.addEventListener("change", (event) => {
      AppState.wallpaperSwitchSeconds = clamp(Math.round((Number(event.target.value) || 60) * 10) / 10, 0.1, 3600);
      event.target.value = AppState.wallpaperSwitchSeconds;
      AppState.lastWallpaperSwitch = performance.now();
      saveState();
    });
    document.getElementById("pause-btn")?.addEventListener("click", togglePause2);
    if (resetBtn) resetBtn.addEventListener("click", hardReset2);
    document.getElementById("jump-btn")?.addEventListener("click", jumpLatentRegion2);
    document.getElementById("save-btn")?.addEventListener("click", exportMainCanvas);
    document.getElementById("record-btn")?.addEventListener("click", toggleSequenceRecording);
    document.getElementById("universe-batch-btn")?.addEventListener("click", exportUniverseBatchZip);
    document.getElementById("lang-btn")?.addEventListener("click", toggleLanguage);
    document.getElementById("color-count")?.addEventListener("input", (event) => setColorLimit(event.target.value));
    document.getElementById("randomness")?.addEventListener("input", (event) => setRandomness(event.target.value));
    document.getElementById("form-linear-btn")?.addEventListener("click", () => setGeometryMode("linear"));
    document.getElementById("form-radial-btn")?.addEventListener("click", () => setGeometryMode("radial"));
    document.getElementById("layer-auto-btn")?.addEventListener("click", () => setLayerMode("auto"));
    document.getElementById("layer-x-btn")?.addEventListener("click", () => setLayerMode("xTop"));
    document.getElementById("layer-y-btn")?.addEventListener("click", () => setLayerMode("yTop"));
    document.getElementById("act-relu-btn")?.addEventListener("click", () => setActivationMode("relu"));
    document.getElementById("act-leaky-btn")?.addEventListener("click", () => setActivationMode("leaky"));
    document.getElementById("act-tanh-btn")?.addEventListener("click", () => setActivationMode("tanh"));
    document.getElementById("act-swish-btn")?.addEventListener("click", () => setActivationMode("swish"));
    document.getElementById("axis-both-btn")?.addEventListener("click", () => setAxisMode("both"));
    document.getElementById("axis-x-btn")?.addEventListener("click", () => setAxisMode("x"));
    document.getElementById("axis-y-btn")?.addEventListener("click", () => setAxisMode("y"));
    document.getElementById("palette-auto-btn")?.addEventListener("click", clearManualPalette);
    document.getElementById("palette-manual-btn")?.addEventListener("click", enableManualPalette);
    document.getElementById("latent-map-canvas")?.addEventListener("click", jumpToLatentMap);
    const axisSlot = document.getElementById("wallpaper-axis-slot");
    const axisControls = document.querySelector(".axis-controls");
    if (axisSlot && axisControls) axisSlot.appendChild(axisControls);
    const colorSlot = document.getElementById("wallpaper-color-slot");
    const colorPanel = document.querySelector(".palette-panel");
    if (colorSlot && colorPanel) colorSlot.appendChild(colorPanel);
    const colorRow = document.getElementById("color-label");
    if (colorSlot && colorRow) colorSlot.appendChild(colorRow);
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePause2();
          break;
        case "n":
        case "ArrowRight":
          document.getElementById("next-btn")?.click();
          break;
        case "r":
          hardReset2();
          break;
        case "j":
          jumpLatentRegion2();
          break;
        case "s":
          exportMainCanvas();
          break;
      }
    });
    window.addEventListener("resize", () => applyWallpaperDisplay());
    if (window.wallpaperPropertyListener === void 0) {
      window.wallpaperPropertyListener = {
        applyUserProperties(properties) {
          if (properties.randommode) setWallpaperRandomMode(properties.randommode.value === 1 ? "universe" : "growth");
          if (properties.displaymode) setWallpaperDisplayMode(properties.displaymode.value === 1 ? "square" : "fill");
          if (properties.switchseconds) {
            AppState.wallpaperSwitchSeconds = clamp(Math.round((Number(properties.switchseconds.value) || 60) * 10) / 10, 0.1, 3600);
            const el = document.getElementById("switch-seconds");
            if (el) el.value = String(AppState.wallpaperSwitchSeconds);
          }
          if (properties.axis) setAxisMode(["both", "x", "y"][properties.axis.value] || "both");
          if (properties.outercolor) {
            AppState.wallpaperOuterColor = properties.outercolor.value;
            applyWallpaperDisplay(false);
          }
        }
      };
    }
    const switchEl = document.getElementById("switch-seconds");
    if (switchEl) switchEl.value = String(AppState.wallpaperSwitchSeconds);
    const outerEl = document.getElementById("outer-color");
    if (outerEl) outerEl.value = AppState.wallpaperOuterColor;
    syncControlUI();
    applyLanguage();
  }

  // src/js/liquidGlass.js
  var SELECTOR = "#studio-btn, #settings-btn, #pause-btn, #next-btn";
  var MAP_SIZE = 64;
  var DISP_SCALE = 8;
  function smoothStep(a, b, t2) {
    t2 = Math.max(0, Math.min(1, (t2 - a) / (b - a)));
    return t2 * t2 * (3 - 2 * t2);
  }
  function roundedRectSDF(x, y, w, h, r) {
    const qx = Math.abs(x) - w + r;
    const qy = Math.abs(y) - h + r;
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  }
  function applyLiquidGlass() {
    const buttons = document.querySelectorAll(SELECTOR);
    if (!buttons.length) return;
    if (typeof CSS === "undefined" || !CSS.supports("backdrop-filter", "url(#x) blur(1px)")) return;
    const id = "liquidglass-" + Math.random().toString(36).slice(2, 10);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.cssText = "position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;";
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    filter.setAttribute("id", id + "_f");
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("colorInterpolationFilters", "sRGB");
    filter.setAttribute("x", "0");
    filter.setAttribute("y", "0");
    filter.setAttribute("width", String(MAP_SIZE));
    filter.setAttribute("height", String(MAP_SIZE));
    const feImage = document.createElementNS("http://www.w3.org/2000/svg", "feImage");
    feImage.setAttribute("id", id + "_m");
    feImage.setAttribute("width", String(MAP_SIZE));
    feImage.setAttribute("height", String(MAP_SIZE));
    const feDisp = document.createElementNS("http://www.w3.org/2000/svg", "feDisplacementMap");
    feDisp.setAttribute("in", "SourceGraphic");
    feDisp.setAttribute("in2", id + "_m");
    feDisp.setAttribute("xChannelSelector", "R");
    feDisp.setAttribute("yChannelSelector", "G");
    feDisp.setAttribute("scale", String(DISP_SCALE));
    filter.appendChild(feImage);
    filter.appendChild(feDisp);
    defs.appendChild(filter);
    svg.appendChild(defs);
    document.body.appendChild(svg);
    const canvas = document.createElement("canvas");
    canvas.width = MAP_SIZE;
    canvas.height = MAP_SIZE;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(MAP_SIZE, MAP_SIZE);
    const data = img.data;
    const raw = [];
    let maxScale = 0;
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const ux = x / MAP_SIZE, uy = y / MAP_SIZE;
        const ix = ux - 0.5, iy = uy - 0.5;
        const dist = roundedRectSDF(ix, iy, 0.5, 0.5, 0.5);
        const disp = smoothStep(0.8, 0, dist - 0.15);
        const scaled = smoothStep(0, 1, disp);
        const px = ix * scaled + 0.5;
        const py = iy * scaled + 0.5;
        const dx = px * MAP_SIZE - x;
        const dy = py * MAP_SIZE - y;
        maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
        raw.push(dx, dy);
      }
    }
    maxScale *= 0.5;
    if (maxScale <= 0) maxScale = 1;
    for (let i = 0, k = 0; i < data.length; i += 4, k += 2) {
      data[i] = (raw[k] / maxScale + 0.5) * 255;
      data[i + 1] = (raw[k + 1] / maxScale + 0.5) * 255;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    feImage.setAttributeNS("http://www.w3.org/1999/xlink", "href", canvas.toDataURL());
    buttons.forEach((b) => {
      b.style.backdropFilter = `url(#${id}_f) blur(22px) saturate(150%)`;
    });
  }

  // src/js/main.js
  function freshUniverse() {
    AppState.universeSeed = createUniverseSeed();
    AppState.universeDecoder = new DecoderNetwork();
    AppState.currentEntity = new LatentEntity();
    AppState.generationCount = 0;
    AppState.colorLimit = 0;
    AppState.axisMode = "both";
    AppState.layerMode = "auto";
    AppState.activationMode = "relu";
    AppState.currentLanguage = "en";
    AppState.wallpaperRandomMode = "growth";
    AppState.wallpaperDisplayMode = "square";
    AppState.wallpaperSwitchSeconds = 1;
    AppState.wallpaperOuterColor = "#ffffff";
    AppState.manualPaletteIndices = [];
    randomizeRuntimeControls();
    setActiveRendererName("linear");
    setActivePaletteName("classic");
  }
  function bootstrap() {
    if (AppState.hasBootstrapped) return;
    AppState.hasBootstrapped = true;
    initMatrixUI();
    initLatentProjector();
    if (!restoreSavedState()) freshUniverse();
    AppState.lastParams = null;
    AppState.lastForwardState = null;
    AppState.previousDecoderState = null;
    AppState.isPaused = false;
    bindControls({ togglePause, hardReset, jumpLatentRegion, nextWallpaper });
    const secondsInput = document.getElementById("switch-seconds");
    if (secondsInput) secondsInput.value = String(AppState.wallpaperSwitchSeconds);
    const outerColorInput = document.getElementById("outer-color");
    if (outerColorInput) outerColorInput.value = AppState.wallpaperOuterColor;
    setWallpaperRandomMode(AppState.wallpaperRandomMode);
    applyWallpaperDisplay(false);
    setPausedVisual(false);
    applyLanguage();
    syncControlUI();
    updateText2("gen-counter", AppState.generationCount);
    updateMatrixUI(AppState.currentEntity);
    drawArt(getCanvas(), AppState.currentEntity);
    runSelfTests();
    applyLiquidGlass();
    startAnimation();
  }
  function loop(timestamp) {
    if (AppState.isPaused) return;
    if (!AppState.currentEntity || !AppState.universeDecoder) {
      AppState.animationId = requestAnimationFrame(loop);
      return;
    }
    if (!AppState.lastWallpaperSwitch) AppState.lastWallpaperSwitch = timestamp;
    if (timestamp - AppState.lastWallpaperSwitch >= AppState.wallpaperSwitchSeconds * 1e3) {
      AppState.lastWallpaperSwitch = timestamp;
      advanceWallpaper();
      drawArt(getCanvas(), AppState.currentEntity);
      captureSequenceFrame(AppState.currentEntity, AppState.generationCount);
      updateText2("gen-counter", AppState.generationCount);
      updateMatrixUI(AppState.currentEntity);
      saveState();
    }
    AppState.animationId = requestAnimationFrame(loop);
  }
  function startAnimation() {
    if (AppState.animationId !== null) cancelAnimationFrame(AppState.animationId);
    AppState.lastWallpaperSwitch = performance.now();
    AppState.animationId = requestAnimationFrame(loop);
  }
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
    AppState.universeSeed = createUniverseSeed();
    AppState.universeDecoder = new DecoderNetwork();
    AppState.currentEntity = new LatentEntity();
    AppState.generationCount = 0;
    AppState.lastParams = null;
    AppState.lastForwardState = null;
    AppState.previousDecoderState = null;
    latentTrail.length = 0;
    AppState.lastPersistFrame = 0;
    randomizeRuntimeControls();
    AppState.manualPaletteIndices = [];
    AppState.colorLimit = 0;
    AppState.layerMode = "auto";
    AppState.activationMode = "relu";
    updateText2("gen-counter", AppState.generationCount);
    syncControlUI();
    updateMatrixUI(AppState.currentEntity);
    drawArt(getCanvas(), AppState.currentEntity);
    saveState();
    if (!AppState.isPaused) startAnimation();
  }
  function jumpLatentRegion() {
    if (!AppState.currentEntity) return;
    AppState.currentEntity.jump(0.55);
    latentTrail.length = 0;
    AppState.previousDecoderState = null;
    drawArt(getCanvas(), AppState.currentEntity);
    updateMatrixUI(AppState.currentEntity);
    saveState();
  }
  function runSelfTests() {
    try {
      const decoder = new DecoderNetwork();
      const entity = new LatentEntity();
      assert(decoder instanceof DecoderNetwork, "DecoderNetwork should initialize");
      assert(entity instanceof LatentEntity, "LatentEntity should initialize");
      assert(entity.z.length === LATENT_DIM, "Latent vector dimension should match LATENT_DIM");
      assert(entity.velocity.length === LATENT_DIM, "Velocity vector dimension should match LATENT_DIM");
      const output = decoder.decode(entity.z);
      assert(output instanceof Float32Array, "Decoder output should be Float32Array");
      assert(output.length === OUT_DIM, "Decoder output length should match OUT_DIM");
      const forwardState = decoder.forward(entity.z);
      assert(forwardState.h1.length === HIDDEN_1, "Forward h1 length should match HIDDEN_1");
      assert(forwardState.h2.length === HIDDEN_2, "Forward h2 length should match HIDDEN_2");
      assert(forwardState.out.length === OUT_DIM, "Forward out length should match OUT_DIM");
      const beforeStep = entity.z[0];
      entity.step(0.04);
      assert(Number.isFinite(entity.z[0]), "Latent step should keep finite values");
      assert(beforeStep !== entity.z[0], "Latent step should change state");
      const params = entity.getPhysicalParams(decoder);
      assert(Array.isArray(params.paletteIndices), "Palette index list should be an array");
      assert(params.paletteIndices.length >= 1, "Palette should contain at least one active color");
      assert(params.paletteIndices.length <= 32, "Palette should be capped at 32 colors");
      assert(params.vDensity > 0, "vDensity should be positive");
      assert(params.hDensity > 0, "hDensity should be positive");
      assert(params.stepMod > 0, "stepMod should be positive");
      assert(params.vSkipRate >= 0 && params.vSkipRate <= 0.28, "vSkipRate out of expected range");
      assert(params.hSkipRate >= 0 && params.hSkipRate <= 0.28, "hSkipRate out of expected range");
      assert(params._forwardState && params._forwardState.out.length === OUT_DIM, "Params should include forward state");
      assert(latentProjector.x instanceof Float32Array, "latentProjector.x should initialize");
      assert(latentProjector.y instanceof Float32Array, "latentProjector.y should initialize");
      const projected = projectLatentTo2D(entity.z);
      assert(Number.isFinite(projected.x) && Number.isFinite(projected.y), "2D latent projection should be finite");
      const testStripes = generateStripes(
        "vertical",
        100,
        { density: 0.03, widthMean: 1, widthJitter: 1, skipRate: 0, minWidth: 0.01, clusterBias: 1, zBias: 0 },
        () => "#000000",
        { whitespaceBias: 0, zSpread: 1, globalZBias: 0 }
      );
      assert(testStripes.length > 0, "generateStripes should create stripes");
      assert(testStripes.every((s) => Number.isInteger(s.pos)), "Stripe positions should be pixel-aligned integers");
      assert(testStripes.every((s) => Number.isInteger(s.size)), "Stripe sizes should be pixel-aligned integers");
      assert(testStripes.every((s) => s.size >= 1), "Stripe sizes should be at least 1 pixel");
      const testRadial = generateRadialSegments(
        "sector",
        TAU,
        { density: 0.2, widthMean: 1, widthJitter: 1, skipRate: 0, minWidth: 0.02, clusterBias: 1, zBias: 0 },
        () => "#000000",
        { whitespaceBias: 0, zSpread: 1, globalZBias: 0 }
      );
      assert(testRadial.length > 0, "generateRadialSegments should create radial parts");
      assert(testRadial.every((s) => s.pos >= 0 && s.size > 0), "Radial parts should have positive spans");
      const beforeJump = entity.z[1];
      entity.jump(0.95);
      assert(Number.isFinite(entity.z[1]), "Latent jump should keep finite values");
      assert(beforeJump !== entity.z[1], "Latent jump should change state");
      assert(typeof hardReset === "function", "hardReset should be defined");
      assert(typeof togglePause === "function", "togglePause should be defined");
      assert(typeof jumpLatentRegion === "function", "jumpLatentRegion should be defined");
      const colors = params.paletteIndices.map((idx) => classicPalette.colors[idx]);
      assert(colors.every((c) => typeof c === "string" && c.startsWith("#")), "Palette colors should be valid hex strings");
      const decSerial = serializeDecoder(decoder);
      const decRestored = restoreDecoder(decSerial);
      const outOrig = decoder.decode(entity.z);
      const outRest = decRestored.decode(entity.z);
      assert(outOrig.every((v, i) => Math.abs(v - outRest[i]) < 1e-4), "decoder serialise round-trip");
      const entSerial = serializeEntity(entity);
      const entRest = restoreEntity(entSerial);
      assert(entRest.z.every((v, i) => Math.abs(v - entity.z[i]) < 1e-4), "entity serialise round-trip");
      console.info("[Self-test] All checks passed.");
    } catch (err) {
      console.error("[Self-test] FAILED:", err.message);
    }
  }
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
    drawArt,
    getCanvas,
    startAnimation,
    setPalette,
    AppState,
    FPS_LIMIT,
    FRAME_DELAY
  });
  Object.defineProperty(window, "isPaused", {
    get: () => AppState.isPaused,
    configurable: true
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
