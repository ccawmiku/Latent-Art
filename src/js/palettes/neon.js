/**
 * Built-in palette: Neon — vivid electric colours.
 */
import { registerPalette } from './registry.js';

export const neonPalette = {
    label: 'NEON',
    colors: [
        '#FF0080', '#FF00FF', '#8000FF', '#4000FF',
        '#0040FF', '#0090FF', '#00FFFF', '#00FF80',
        '#00FF00', '#80FF00', '#FFFF00', '#FFB300',
        '#FF6600', '#FF3300', '#FF0050', '#FF0030',
        '#FF80C0', '#FF80FF', '#C080FF', '#80C0FF',
        '#80FFFF', '#80FFCC', '#80FF80', '#CCFF80',
        '#FFFF80', '#FFD480', '#FFAA80', '#FF8080',
        '#FF80A0', '#CC00FF', '#0022CC', '#006633',
    ],
};

registerPalette('neon', neonPalette);
