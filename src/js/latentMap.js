import { MAX_TRAIL_POINTS, LATENT_DIM, HIDDEN_1, HIDDEN_2, OUT_DIM } from './constants.js';
import { clamp, scientificColor, randNormal } from './math.js';

// ── Module-level mutable state ────────────────────────────────────────────

/** Random orthonormal projection axes for visualising the latent trail */
export const latentProjector = { x: null, y: null };
export const latentTrail     = [];
export const latentMapViewport = { scale: 1, maxAbs: 1 };

// ── Projector init ────────────────────────────────────────────────────────

function normalizeVector(vec) {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
}

export function initLatentProjector() {
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

// ── Projection + trail ────────────────────────────────────────────────────

export function projectLatentTo2D(z) {
    if (!latentProjector.x || !latentProjector.y) return { x: 0, y: 0 };
    let px = 0, py = 0;
    for (let i = 0; i < z.length; i++) {
        px += z[i] * latentProjector.x[i];
        py += z[i] * latentProjector.y[i];
    }
    return { x: px, y: py };
}

/** Append point to trail; returns current movement speed. */
export function pushLatentTrail(point) {
    const prev  = latentTrail[latentTrail.length - 1];
    const speed = prev ? Math.hypot(point.x - prev.x, point.y - prev.y) : 0;
    latentTrail.push({ x: point.x, y: point.y, speed });
    if (latentTrail.length > MAX_TRAIL_POINTS) latentTrail.shift();
    return speed;
}

// ── Latent map canvas ─────────────────────────────────────────────────────

export function drawLatentMap(canvas, currentPoint) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.imageSmoothingEnabled = false;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, w, h);

    // Cross-hairs
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    ctx.stroke();

    let maxAbs = 1;
    for (const p of latentTrail) maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
    const scale = 0.42 * Math.min(w, h) / maxAbs;
    latentMapViewport.scale  = scale;
    latentMapViewport.maxAbs = maxAbs;
    const mapX = x => w / 2 + x * scale;
    const mapY = y => h / 2 - y * scale;

    // Trail
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

    // Current position dot
    ctx.beginPath();
    ctx.arc(mapX(currentPoint.x), mapY(currentPoint.y), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mapX(currentPoint.x), mapY(currentPoint.y), 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth   = 2;
    ctx.stroke();
}

// ── Decoder visualisation canvas ──────────────────────────────────────────

/**
 * Render the layer-activation heat map.
 * @returns {object|null} new previousDecoderState to store in AppState
 */
export function drawDecoderView(canvas, forwardState, previousDecoderState) {
    if (!canvas || !forwardState) return previousDecoderState;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, w, h);

    const panelCell = 6, panelY = 48;
    const prev   = previousDecoderState;
    const layers = [
        { label: 'Z',   dim: LATENT_DIM, values: forwardState.latent, prev: prev?.latent, cols: 12, rows: 16, x: 16  },
        { label: 'H1',  dim: HIDDEN_1,   values: forwardState.h1,     prev: prev?.h1,     cols: 12, rows:  8, x: 116 },
        { label: 'H2',  dim: HIDDEN_2,   values: forwardState.h2,     prev: prev?.h2,     cols:  8, rows:  8, x: 216 },
        { label: 'OUT', dim: OUT_DIM,    values: forwardState.out,    prev: prev?.out,    cols:  8, rows:  8, x: 316 },
    ];

    for (const layer of layers) {
        ctx.fillStyle = '#9ca3af';
        ctx.font = '10px monospace';
        ctx.fillText(`${layer.label} ${layer.dim}`, layer.x, 20);

        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.strokeRect(layer.x - 1, panelY - 1, layer.cols * panelCell + 1, layer.rows * panelCell + 1);

        let m = 1e-6;
        for (const v of layer.values) m = Math.max(m, Math.abs(v));

        let maxDelta = 1e-6;
        if (layer.prev)
            for (let i = 0; i < layer.values.length; i++)
                maxDelta = Math.max(maxDelta, Math.abs(layer.values[i] - layer.prev[i]));

        for (let i = 0; i < layer.cols * layer.rows; i++) {
            if (i >= layer.values.length) continue;
            const v      = layer.values[i];
            const signed = clamp(v / m, -1, 1);
            const delta  = layer.prev ? Math.abs(v - layer.prev[i]) / maxDelta : 0;
            const colorT = clamp((signed + 1) / 2 + delta * 0.16, 0, 1);
            const alpha  = 0.76 + delta * 0.24;
            ctx.fillStyle = scientificColor(colorT, alpha);
            ctx.fillRect(
                layer.x + (i % layer.cols) * panelCell,
                panelY  + Math.floor(i / layer.cols) * panelCell,
                panelCell - 1, panelCell - 1
            );
        }
    }

    return {
        latent: new Float32Array(forwardState.latent),
        h1:     new Float32Array(forwardState.h1),
        h2:     new Float32Array(forwardState.h2),
        out:    new Float32Array(forwardState.out),
    };
}
