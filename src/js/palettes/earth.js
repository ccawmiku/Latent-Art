/**
 * Built-in palette: Earth — organic, muted, natural tones.
 */
import { registerPalette } from './registry.js';

export const earthPalette = {
    label: 'EARTH',
    colors: [
        '#8B4513', '#A0522D', '#6B4423', '#D2691E',
        '#CD853F', '#DEB887', '#F5DEB3', '#FFDEAD',
        '#D2B48C', '#BC8F8F', '#F4A460', '#DAA520',
        '#B8860B', '#8B7355', '#696969', '#808080',
        '#556B2F', '#6B8E23', '#808000', '#9ACD32',
        '#228B22', '#2E8B57', '#3CB371', '#20B2AA',
        '#4682B4', '#708090', '#778899', '#2F4F4F',
        '#8B8682', '#C0C0C0', '#FFFACD', '#FAF0E6',
    ],
};

registerPalette('earth', earthPalette);
