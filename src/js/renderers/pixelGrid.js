/**
 * Pixel Grid renderer — a mosaic of discrete cells driven by the same latent
 * params as the stripe renderers.
 *
 * Parameter mapping (reuses decoded params, no decoder change needed):
 *   vDensity  → column count (higher = more columns = smaller cells)
 *   hDensity  → row count
 *   vSkipRate + hSkipRate → combined cell skip probability (sparse/dense)
 *   whitespaceBias → additional skip bias
 *   zSpread / vZBias / hZBias → per-cell colour-family dominance
 *   vPickColor / hPickColor → colour families for each axis
 *   layerMode → which axis "wins" when both are active
 */

import { clamp } from '../math.js';
import { registerRenderer } from './registry.js';

export const pixelGridRenderer = {
    label: 'PIXELS',

    /** @param {CanvasRenderingContext2D} ctx @param {import('./base.js').RenderContext} c */
    render(ctx, c) {
        const { params, axisMode, layerMode, vSampler, hSampler, vPickColor, hPickColor } = c;
        const w = ctx.canvas.width;
        const h = ctx.canvas.height;

        // ── Grid dimensions ───────────────────────────────────────────
        // ~20 base cells, scaled by density so the network influences grid size
        const cols  = Math.max(4, Math.round(w * params.vDensity * 22) + 2);
        const rows  = Math.max(4, Math.round(h * params.hDensity * 22) + 2);
        const cellW = w / cols;
        const cellH = h / rows;

        // ── Background ────────────────────────────────────────────────
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(0, 0, w, h);

        const skip = clamp(
            (params.vSkipRate + params.hSkipRate) / 2 + params.whitespaceBias,
            0, 0.50
        );
        // 1-pixel gap between cells for a clean grid look; disabled when edgeExpand > 0
        const gap = params.edgeExpand > 0 ? 0 : 1;

        // ── Raster ───────────────────────────────────────────────────
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const salt = `${col}:${row}`;

                if (vSampler(`keep:${salt}`) <= skip) continue;

                let color;
                if (axisMode === 'x') {
                    color = vPickColor(`c:${salt}`);
                } else if (axisMode === 'y') {
                    color = hPickColor(`c:${salt}`);
                } else {
                    // Compare z-depths to decide which axis colours this cell
                    const vZ = vSampler(`z:${col}`) * params.zSpread + params.vZBias + params.globalZBias;
                    const hZ = hSampler(`z:${row}`) * params.zSpread + params.hZBias + params.globalZBias;

                    if (layerMode === 'xTop') {
                        color = vPickColor(`c:${salt}`);
                    } else if (layerMode === 'yTop') {
                        color = hPickColor(`c:${salt}`);
                    } else {
                        color = vZ > hZ ? vPickColor(`c:${salt}`) : hPickColor(`c:${salt}`);
                    }
                }

                // Pixel-align cell rect to avoid sub-pixel rendering artefacts
                const px = Math.round(col * cellW);
                const py = Math.round(row * cellH);
                const cw = Math.round((col + 1) * cellW) - px;
                const ch = Math.round((row + 1) * cellH) - py;

                ctx.fillStyle = color;
                ctx.fillRect(px, py, Math.max(1, cw - gap), Math.max(1, ch - gap));
            }
        }
    },
};

registerRenderer('pixelGrid', pixelGridRenderer);
