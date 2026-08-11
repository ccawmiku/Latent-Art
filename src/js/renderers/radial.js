/**
 * Radial renderer — sector (pie-wedge) + ring composition inside a circle.
 * Reuses sortPartsForLayerMode from sort.js.
 */

import { clamp } from '../math.js';
import { TAU, STRIPE_DENSITY_SCALE } from '../constants.js';
import { registerRenderer } from './registry.js';
import { sortPartsForLayerMode } from './sort.js';

// ── Radial segment generation ─────────────────────────────────────────────

/**
 * @param {'sector'|'ring'} dir
 * @param {number} span          - TAU for sectors, radius (px) for rings
 * @param {object} config
 * @param {function} pickColor
 * @param {object} globalConfig
 * @param {function|null} sampler
 */
export function generateRadialSegments(dir, span, config, pickColor, globalConfig, sampler = null) {
    const segments     = [];
    const combinedSkip = clamp(config.skipRate + globalConfig.whitespaceBias, 0, 0.42);
    let current        = 0;
    let segmentIndex   = 0;

    while (current < span) {
        const widthNoise = sampler ? sampler(`width:${segmentIndex}`) : Math.random();
        const sampled    = span * config.density * config.widthMean * (
            0.35 + Math.pow(widthNoise, 1 + config.clusterBias) * config.widthJitter
        );
        const minSize    = span * config.minWidth;
        const size       = Math.max(sampled, minSize);
        const end        = Math.min(span, current + size);
        const segSize    = end - current;
        if (segSize <= 0.0001) break;

        const keepNoise = sampler ? sampler(`keep:${segmentIndex}`) : Math.random();
        if (keepNoise > combinedSkip) {
            segments.push({
                dir,
                pos:   current,
                size:  segSize,
                color: pickColor(`color:${segmentIndex}`),
                z:     (sampler ? sampler(`z:${segmentIndex}`) : Math.random())
                       * globalConfig.zSpread + config.zBias + globalConfig.globalZBias,
            });
        }

        current = end;
        segmentIndex++;
    }

    return segments;
}

// ── Drawing ───────────────────────────────────────────────────────────────

export function drawRadialParts(ctx, w, h, parts, backgroundColor) {
    const cx            = w / 2;
    const cy            = h / 2;
    const radius        = Math.min(w, h) * 0.47;
    const angleOverlap  = 0.0035;
    const radialOverlap = Math.max(2, radius * 0.004);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.clip();
    ctx.fillStyle = backgroundColor || '#fafafa';
    ctx.fillRect(0, 0, w, h);

    for (const s of parts) {
        ctx.fillStyle = s.color;

        if (s.dir === 'sector') {
            const start = -Math.PI / 2 + s.pos - angleOverlap;
            const end   = -Math.PI / 2 + s.pos + s.size + angleOverlap;
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

// ── Renderer ──────────────────────────────────────────────────────────────

export const radialRenderer = {
    label: 'CIRCLE',

    /** @param {CanvasRenderingContext2D} ctx @param {import('./base.js').RenderContext} c */
    render(ctx, c) {
        const { params, axisMode, layerMode, vSampler, hSampler, vPickColor, hPickColor, paletteColors } = c;
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;
        const radius  = Math.min(w, h) * 0.47;
        const gConfig = { whitespaceBias: params.whitespaceBias, zSpread: params.zSpread, globalZBias: params.globalZBias };

        const sectorSegs = generateRadialSegments('sector', TAU, {
            density:     params.vDensity * STRIPE_DENSITY_SCALE * 0.92 * (0.75 + params.familyBalance * 0.5),
            widthMean:   params.vWidthMean,
            widthJitter: params.vWidthJitter,
            skipRate:    params.vSkipRate,
            minWidth:    Math.max(0.006, params.vMinWidth * 1.1),
            clusterBias: params.vClusterBias,
            zBias:       params.vZBias,
        }, vPickColor, gConfig, vSampler);

        const ringSegs = generateRadialSegments('ring', radius, {
            density:     params.hDensity * STRIPE_DENSITY_SCALE * (1.25 - params.familyBalance * 0.5),
            widthMean:   params.hWidthMean,
            widthJitter: params.hWidthJitter,
            skipRate:    params.hSkipRate,
            minWidth:    params.hMinWidth,
            clusterBias: params.hClusterBias,
            zBias:       params.hZBias,
        }, hPickColor, gConfig, hSampler);

        let parts = [];
        if (axisMode === 'both' || axisMode === 'x') parts = parts.concat(sectorSegs);
        if (axisMode === 'both' || axisMode === 'y') parts = parts.concat(ringSegs);

        if (parts.length < 3) {
            if (axisMode === 'both' || axisMode === 'x')
                parts.push({ dir: 'sector', pos: 0,               size: TAU * 0.18,    color: paletteColors[0], z: 0 });
            if (axisMode === 'both' || axisMode === 'y')
                parts.push({ dir: 'ring',   pos: radius * 0.24, size: radius * 0.28, color: paletteColors[6], z: 1 });
        }

        const bg = params.paletteIndices.length > 0
            ? (paletteColors[params.paletteIndices[0]] ?? '#fafafa')
            : '#fafafa';

        sortPartsForLayerMode(parts, layerMode);
        drawRadialParts(ctx, w, h, parts, bg);
    },
};

registerRenderer('radial', radialRenderer);
