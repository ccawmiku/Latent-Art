/**
 * export.js — PNG, ZIP sequence recording, and canvas-batch export.
 * Behaviour matches the original inline implementation (offscreen renders at
 * the sequence-size output resolution).
 */

import { AppState }                          from './appState.js';
import { randomizeRuntimeControls }          from './appState.js';
import { drawArt, getCanvas }                from './renderer.js';
import { DecoderNetwork }                    from './decoder.js';
import { LatentEntity }                      from './entity.js';
import { createCanvasSeed, clamp }         from './math.js';
import { updateText, updateMatrixUI, syncControlUI } from './ui.js';
import { snapshotRuntimeState, restoreRuntimeState, saveState, serializeEntity, restoreEntity } from './state.js';
import { latentTrail }                       from './latentMap.js';

// ── Download helpers ──────────────────────────────────────────────────────

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
}

export function canvasToPngBlob(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

function getNumberInputValue(id, fallback, min, max) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const v = Number(el.value);
    if (!Number.isFinite(v)) return fallback;
    return clamp(Math.round(v), min, max);
}

export async function exportMainCanvas() {
    if (!AppState.currentEntity || !AppState.canvasDecoder) return;
    const outputSize  = getNumberInputValue('sequence-size', 2400, 1200, 4096);
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width  = outputSize;
    exportCanvas.height = outputSize;

    drawArt(exportCanvas, AppState.currentEntity, {
        updatePanels: false,
        generationCount: AppState.generationCount,
    });

    const blob = await canvasToPngBlob(exportCanvas);
    downloadBlob(blob, `latent-art-${String(AppState.generationCount).padStart(6, '0')}-${outputSize}px.png`);
}

// ── Minimal ZIP builder (no external deps) ────────────────────────────────

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u16(v)  { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v, true); return b; }
function u32(v)  { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; }

function dosDateTime() {
    const d = new Date();
    return {
        time: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) >>> 0,
        date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) >>> 0,
    };
}

export function makeZipBlob(entries) {
    const localParts = [];
    const centralDir = [];
    let offset       = 0;

    for (const { name, data } of entries) {
        const nameBytes = new TextEncoder().encode(name);
        const crc       = crc32(data);
        const dt        = dosDateTime();
        const local     = new Uint8Array([
            0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00,
            0x00, 0x00,
            ...u16(dt.time), ...u16(dt.date),
            ...u32(crc),     ...u32(data.length), ...u32(data.length),
            ...u16(nameBytes.length), ...u16(0),
            ...nameBytes, ...data,
        ]);
        localParts.push(local);

        centralDir.push(new Uint8Array([
            0x50, 0x4B, 0x01, 0x02, 0x14, 0x00, 0x14, 0x00,
            0x00, 0x00, 0x00, 0x00,
            ...u16(dt.time), ...u16(dt.date),
            ...u32(crc),     ...u32(data.length), ...u32(data.length),
            ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
            ...u32(0), ...u32(offset),
            ...nameBytes,
        ]));

        offset += local.length;
    }

    const cdSize   = centralDir.reduce((n, b) => n + b.length, 0);
    const eocd     = new Uint8Array([
        0x50, 0x4B, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00,
        ...u16(entries.length), ...u16(entries.length),
        ...u32(cdSize), ...u32(offset),
        ...u16(0),
    ]);

    const parts = [...localParts, ...centralDir, eocd];
    const total = parts.reduce((n, b) => n + b.length, 0);
    const zip   = new Uint8Array(total);
    let pos     = 0;
    for (const p of parts) { zip.set(p, pos); pos += p.length; }
    return new Blob([zip], { type: 'application/zip' });
}

// ── Sequence recording ────────────────────────────────────────────────────

function resetRecordButton(label = 'RECORD ZIP') {
    const btn = document.getElementById('record-btn');
    if (btn) { btn.innerText = label; btn.classList.remove('recording'); }
}

export function updateRecordButton() {
    const recorder = AppState.sequenceRecorder;
    const btn      = document.getElementById('record-btn');
    if (!btn) return;
    if (recorder && (recorder.active || recorder.pendingCaptures > 0)) {
        const total = recorder.targetFrames;
        const done  = Math.min(recorder.entries.length + recorder.pendingCaptures, total);
        btn.innerText = `${done}/${total}`;
        btn.classList.add('recording');
    } else {
        btn.innerText = 'RECORD ZIP';
        btn.classList.remove('recording');
    }
}

export function toggleSequenceRecording() {
    if (AppState.isRecordingSequence) {
        stopSequenceRecording();
        return;
    }
    if (!AppState.currentEntity || !AppState.canvasDecoder) return;

    const targetFrames = getNumberInputValue('sequence-frames', 240, 1, 1000);
    const outputSize   = getNumberInputValue('sequence-size', 2400, 1200, 4096);
    const interval     = getNumberInputValue('sequence-interval', 1, 1, 100);

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
        finishing: false,
    };
    AppState.isRecordingSequence = true;
    updateRecordButton();
}

export function stopSequenceRecording() {
    const recorder = AppState.sequenceRecorder;
    if (!recorder) return;
    recorder.stopRequested = true;
    recorder.active = false;
    updateRecordButton();
    finishSequenceRecordingIfReady();
}

export function captureSequenceFrame(entity, renderGeneration) {
    const recorder = AppState.sequenceRecorder;
    if (!recorder || !recorder.active || recorder.stopRequested) return;
    if (recorder.entries.length + recorder.pendingCaptures >= recorder.targetFrames) {
        stopSequenceRecording();
        return;
    }

    recorder.visibleFrameCount++;
    if ((recorder.visibleFrameCount - 1) % recorder.interval !== 0) return;

    const frameNumber     = recorder.entries.length + recorder.pendingCaptures + 1;
    const entitySnapshot  = restoreEntity(serializeEntity(entity));
    recorder.pendingCaptures++;
    updateRecordButton();

    captureSequenceFrameAsync(recorder, entitySnapshot, renderGeneration, frameNumber);
}

async function captureSequenceFrameAsync(recorder, entitySnapshot, renderGeneration, frameNumber) {
    try {
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width  = recorder.outputSize;
        captureCanvas.height = recorder.outputSize;

        drawArt(captureCanvas, entitySnapshot, {
            updatePanels: false,
            generationCount: renderGeneration,
        });

        const blob = await canvasToPngBlob(captureCanvas);
        recorder.entries.push({
            name: `latent-art-frame-${String(frameNumber).padStart(6, '0')}.png`,
            data: new Uint8Array(await blob.arrayBuffer()),
        });
    } catch (err) {
        console.error('[Sequence export] Frame capture failed:', err);
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
        const filename = `latent-art-sequence-gen-${String(recorder.startGeneration).padStart(6, '0')}-${recorder.outputSize}px-${entries.length}f-step${recorder.interval}.zip`;
        downloadBlob(zip, filename);
        resetRecordButton('RECORD ZIP');
    } else {
        resetRecordButton('NO FRAMES');
        setTimeout(() => resetRecordButton(), 900);
    }

    AppState.isRecordingSequence = false;
    AppState.sequenceRecorder = null;
}

// ── Canvas batch export ─────────────────────────────────────────────────

export async function exportCanvasBatchZip() {
    if (AppState.isRecordingCanvasBatch || AppState.isRecordingSequence) return;

    const button      = document.getElementById('canvas-batch-btn');
    const outputSize  = getNumberInputValue('sequence-size', 2400, 1200, 4096);
    const captureCanvas = document.createElement('canvas');
    const entries     = [];
    const snapshot    = snapshotRuntimeState();

    captureCanvas.width  = outputSize;
    captureCanvas.height = outputSize;
    AppState.isRecordingCanvasBatch = true;

    if (button) {
        button.disabled = true;
        button.innerText = 'UNI 0/100';
    }

    try {
        for (let i = 0; i < 100; i++) {
            AppState.canvasSeed          = createCanvasSeed();
            AppState.canvasDecoder       = new DecoderNetwork();
            AppState.currentEntity         = new LatentEntity();
            AppState.generationCount       = 0;
            AppState.colorLimit            = 0;
            AppState.manualPaletteIndices  = [];
            randomizeRuntimeControls();

            drawArt(captureCanvas, AppState.currentEntity, {
                updatePanels: false,
                generationCount: i,
            });

            const blob = await canvasToPngBlob(captureCanvas);
            entries.push({
                name: `latent-canvas-${String(i + 1).padStart(6, '0')}.png`,
                data: new Uint8Array(await blob.arrayBuffer()),
            });

            if (button) button.innerText = `UNI ${i + 1}/100`;
            if (i % 5 === 4) await new Promise(resolve => requestAnimationFrame(resolve));
        }

        const zip = makeZipBlob(entries);
        downloadBlob(zip, `latent-canvas-batch-${outputSize}px-100.zip`);
    } catch (err) {
        console.error('[Canvas batch export] Failed:', err);
        if (button) button.innerText = 'BATCH FAILED';
    } finally {
        restoreRuntimeState(snapshot);
        AppState.isRecordingCanvasBatch = false;
        syncControlUI();
        updateText('gen-counter', AppState.generationCount);
        updateMatrixUI(AppState.currentEntity);
        drawArt(getCanvas(), AppState.currentEntity);
        if (button) {
            setTimeout(() => {
                button.disabled = false;
                button.innerText = '100 CANVASES';
            }, 800);
        }
    }
}
