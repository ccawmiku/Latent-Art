/**
 * State serialisation round-trip tests — decoder and latent entity must
 * survive save/restore exactly (within float rounding tolerance).
 */

import { describe, it, expect } from 'vitest';
import { DecoderNetwork } from '../../src/js/decoder.js';
import { LatentEntity }   from '../../src/js/entity.js';
import { serializeDecoder, restoreDecoder, serializeEntity, restoreEntity } from '../../src/js/state.js';

function closeTo(a, b, tol = 1e-4) {
    expect(a).toBeCloseTo(b, 4);
}

describe('state serialisation round-trip', () => {
    it('decoder round-trips to identical outputs', () => {
        const dec      = new DecoderNetwork();
        const z        = new Float32Array(192).fill(0.5);
        const restored = restoreDecoder(serializeDecoder(dec));

        const a = dec.decode(z, 'relu');
        const b = restored.decode(z, 'relu');
        expect(a).toHaveLength(64);
        for (let i = 0; i < a.length; i++) closeTo(a[i], b[i]);
    });

    it('entity round-trips z and velocity', () => {
        const ent = new LatentEntity();
        ent.step(0.05);
        ent.jump(0.3);

        const restored = restoreEntity(serializeEntity(ent));
        expect(restored.z.length).toBe(ent.z.length);
        expect(restored.velocity.length).toBe(ent.velocity.length);
        for (let i = 0; i < ent.z.length; i++) closeTo(restored.z[i], ent.z[i]);
        for (let i = 0; i < ent.velocity.length; i++) closeTo(restored.velocity[i], ent.velocity[i]);
    });

    it('handles null / missing data gracefully', () => {
        expect(serializeDecoder(null)).toBeNull();
        expect(serializeEntity(null)).toBeNull();

        expect(restoreDecoder(null)).toBeInstanceOf(DecoderNetwork);
        expect(restoreEntity(null)).toBeInstanceOf(LatentEntity);
    });
});
