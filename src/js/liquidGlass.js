/**
 * liquidGlass.js — Liquid-glass frosted effect for the home icon buttons.
 *
 * Adapted from https://github.com/shuding/liquid-glass (2025, Shu Ding):
 * an SVG feDisplacementMap filter distorts the backdrop behind each button
 * like looking through a glass lens. A static circular displacement map is
 * baked once; the existing CSS backdrop-filter (blur/saturate) is kept as a
 * graceful fallback for browsers that do not render `backdrop-filter: url(...)`.
 */

const SELECTOR = '#settings-btn, #pause-btn, #next-btn';
const MAP_SIZE = 64;      // displacement map resolution (px)
const DISP_SCALE = 8;     // feDisplacementMap magnitude

function smoothStep(a, b, t) {
    t = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

function roundedRectSDF(x, y, w, h, r) {
    const qx = Math.abs(x) - w + r;
    const qy = Math.abs(y) - h + r;
    return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

export function applyLiquidGlass() {
    const buttons = document.querySelectorAll(SELECTOR);
    if (!buttons.length) return;
    if (typeof CSS === 'undefined' || !CSS.supports('backdrop-filter', 'url(#x) blur(1px)')) return;

    const id = 'liquidglass-' + Math.random().toString(36).slice(2, 10);

    // ── SVG filter: feImage (map) + feDisplacementMap ──────────────────
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;';

    const defs   = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', id + '_f');
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('colorInterpolationFilters', 'sRGB');
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', String(MAP_SIZE));
    filter.setAttribute('height', String(MAP_SIZE));

    const feImage = document.createElementNS('http://www.w3.org/2000/svg', 'feImage');
    feImage.setAttribute('id', id + '_m');
    feImage.setAttribute('width', String(MAP_SIZE));
    feImage.setAttribute('height', String(MAP_SIZE));

    const feDisp = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap');
    feDisp.setAttribute('in', 'SourceGraphic');
    feDisp.setAttribute('in2', id + '_m');
    feDisp.setAttribute('xChannelSelector', 'R');
    feDisp.setAttribute('yChannelSelector', 'G');
    feDisp.setAttribute('scale', String(DISP_SCALE));

    filter.appendChild(feImage);
    filter.appendChild(feDisp);
    defs.appendChild(filter);
    svg.appendChild(defs);
    document.body.appendChild(svg);

    // ── Displacement map: circular lens distortion ─────────────────────
    const canvas = document.createElement('canvas');
    canvas.width  = MAP_SIZE;
    canvas.height = MAP_SIZE;
    const ctx  = canvas.getContext('2d');
    const img  = ctx.createImageData(MAP_SIZE, MAP_SIZE);
    const data = img.data;

    const raw = [];
    let maxScale = 0;
    for (let y = 0; y < MAP_SIZE; y++) {
        for (let x = 0; x < MAP_SIZE; x++) {
            const ux = x / MAP_SIZE, uy = y / MAP_SIZE;
            const ix = ux - 0.5, iy = uy - 0.5;
            const dist = roundedRectSDF(ix, iy, 0.5, 0.5, 0.5); // circle
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
        data[i]     = (raw[k]     / maxScale + 0.5) * 255;
        data[i + 1] = (raw[k + 1] / maxScale + 0.5) * 255;
        data[i + 2] = 0;
        data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    feImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', canvas.toDataURL());

    // ── Apply to buttons (keeps the CSS frosted blur as fallback) ─────
    buttons.forEach(b => {
        b.style.backdropFilter = `url(#${id}_f) blur(22px) saturate(150%)`;
    });
}
