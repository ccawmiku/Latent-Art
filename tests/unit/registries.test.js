/**
 * Registry tests — renderer and palette registries are the extension points
 * for new structures / palettes, so their contract is tested directly.
 */

import { describe, it, expect } from 'vitest';
import '../../src/js/renderers/index.js'; // registers built-in renderers
import '../../src/js/palettes/index.js';  // registers built-in palettes
import { registerRenderer, getRenderer, listRenderers, setActiveRendererName, getActiveRendererName } from '../../src/js/renderers/registry.js';
import { registerPalette, getPalette, listPalettes, setActivePaletteName, getActivePaletteName } from '../../src/js/palettes/registry.js';

describe('renderer registry', () => {
    it('registers and lists renderers', () => {
        const renderer = { label: 'TEST', render() {} };
        registerRenderer('test-renderer', renderer);
        expect(getRenderer('test-renderer')).toBe(renderer);
        expect(listRenderers()).toContain('test-renderer');
    });

    it('rejects renderers missing render() or label', () => {
        expect(() => registerRenderer('bad-1', { label: 'BAD' })).toThrow();
        expect(() => registerRenderer('bad-2', { render() {} })).toThrow();
    });

    it('built-in renderers are registered', () => {
        expect(listRenderers()).toEqual(expect.arrayContaining(['linear', 'radial']));
        expect(getRenderer('linear').label).toBe('STRIPES');
        expect(getRenderer('radial').label).toBe('CIRCLE');
    });

    it('falls back to linear for unknown names', () => {
        expect(getRenderer('does-not-exist').label).toBe('STRIPES');
    });

    it('sets and reads the active renderer', () => {
        const prev = getActiveRendererName();
        setActiveRendererName('radial');
        expect(getActiveRendererName()).toBe('radial');
        setActiveRendererName(prev);
    });
});

describe('palette registry', () => {
    it('requires exactly 32 colors', () => {
        expect(() => registerPalette('short', { label: 'SHORT', colors: ['#000000'] })).toThrow();
    });

    it('registers valid palettes', () => {
        const good = { label: 'GOOD', colors: Array(32).fill('#000000') };
        registerPalette('good-palette', good);
        expect(getPalette('good-palette')).toBe(good);
        expect(listPalettes()).toContain('good-palette');
    });

    it('built-in palettes are registered with 32 colors', () => {
        for (const name of ['classic', 'neon', 'earth']) {
            expect(getPalette(name).colors).toHaveLength(32);
        }
    });

    it('falls back to classic for unknown names', () => {
        expect(getPalette('nope').label).toBe('CLASSIC');
    });

    it('sets and reads the active palette', () => {
        const prev = getActivePaletteName();
        setActivePaletteName('neon');
        expect(getActivePaletteName()).toBe('neon');
        setActivePaletteName(prev);
    });
});
