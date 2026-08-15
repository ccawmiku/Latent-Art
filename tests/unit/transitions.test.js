/**
 * Transition-mode unit tests — the pure-ish math of the growth (linear step),
 * dim (one latent dim per step) and wipe (reveal sequence) journeys.
 * Canvas rendering itself isn't tested here (jsdom has no 2D context); the
 * reveal redraw correctness is verified in the browser.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AppState }     from '../../src/js/appState.js';
import { LatentEntity } from '../../src/js/entity.js';
import { LATENT_DIM }   from '../../src/js/constants.js';
import {
    generateGrowthTarget,
    growthAdvanceStep,
    generateDimTarget,
    advanceDim,
    buildWipeSequence,
} from '../../src/js/wallpaper.js';

describe('growth linear step', () => {
    beforeEach(() => {
        AppState.currentEntity = new LatentEntity();
        AppState.growthSteps    = 10;
        AppState.growthOvershoot = 50; // os = 1 + 0.5
        AppState.growthStart    = null;
        AppState.growthDelta    = null;
        AppState.growthStepCount = 0;
    });

    it('moves z linearly toward B with the overshoot factor', () => {
        generateGrowthTarget();
        const A = AppState.growthStart;
        const D = AppState.growthDelta;
        growthAdvanceStep();

        const p  = 1 / AppState.growthSteps;
        const os = 1 + AppState.growthOvershoot / 100;
        const z  = AppState.currentEntity.z;
        for (let i = 0; i < LATENT_DIM; i++) {
            expect(z[i]).toBeCloseTo(A[i] + p * os * D[i], 4);
        }
        expect(AppState.growthStepCount).toBe(1);
    });

    it('freezes A and precomputes delta = B − A', () => {
        const before = AppState.currentEntity.z[0];
        generateGrowthTarget();
        expect(AppState.growthStart[0]).toBe(before);
        expect(AppState.growthDelta.length).toBe(LATENT_DIM);
        expect(AppState.growthStepCount).toBe(0);
    });

    it('re-targets after the step cap', () => {
        generateGrowthTarget();
        for (let i = 0; i < AppState.growthSteps; i++) growthAdvanceStep();
        expect(AppState.growthStepCount).toBe(0); // fresh journey
        expect(AppState.growthStart).not.toBeNull();
    });
});

describe('dim step (one latent dim per step)', () => {
    beforeEach(() => {
        AppState.currentEntity = new LatentEntity();
        AppState.dimTarget     = null;
        AppState.dimIndex      = 0;
    });

    it('flips exactly one dim to B per step', () => {
        generateDimTarget();
        const B = AppState.dimTarget;
        const z = AppState.currentEntity.z;

        advanceDim();
        expect(z[0]).toBe(B[0]);
        expect(z[1]).not.toBe(B[1]);
        expect(AppState.dimIndex).toBe(1);

        advanceDim();
        expect(z[1]).toBe(B[1]);
        expect(AppState.dimIndex).toBe(2);
    });

    it('re-targets after all 192 dims are flipped', () => {
        generateDimTarget();
        for (let i = 0; i < LATENT_DIM; i++) advanceDim();
        expect(AppState.dimIndex).toBe(0); // reset by the re-target
        expect(AppState.dimTarget).not.toBeNull();
    });
});

describe('wipe reveal sequence', () => {
    it('ordered = consecutive draw-order groups', () => {
        const seq = buildWipeSequence(50, 'ordered');
        expect(seq.flat()).toEqual([...Array(50).keys()]);
        expect(seq.length).toBe(50); // one part per group under the cap
    });

    it('random = a permutation covering every part once', () => {
        const seq = buildWipeSequence(50, 'random');
        const flat = seq.flat();
        expect(flat.length).toBe(50);
        expect(new Set(flat).size).toBe(50);
        flat.forEach(i => {
            expect(i).toBeGreaterThanOrEqual(0);
            expect(i).toBeLessThan(50);
        });
    });

    it('caps the step count for dense renderers but still covers every part', () => {
        const seq = buildWipeSequence(5000, 'ordered');
        expect(seq.length).toBeLessThanOrEqual(120);
        expect(seq.flat()).toEqual([...Array(5000).keys()]);
    });
});
