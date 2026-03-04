'use strict';

const express  = require('express');
const router   = express.Router();
const zlib     = require('zlib');
const { promisify } = require('util');
const { execFile }  = require('child_process');
const path     = require('path');
const fs       = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const { PDFDocument, PDFName, PDFNumber } = require('pdf-lib');
const sharp = require('sharp');

const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf, OUTPUT_DIR, formatBytes } = require('../services/pdfUtils');

const execFileAsync   = promisify(execFile);
const inflateAsync    = promisify(zlib.inflate);
const inflateRawAsync = promisify(zlib.inflateRaw);

// ─── File-based job store ─────────────────────────────────────────────────────
// Using JSON files instead of an in-memory Map so jobs survive process restarts
// (e.g. Railway redeploys between POST and the first poll).
const JOBS_DIR = OUTPUT_DIR; // reuse the same outputs folder

function jobFile(jobId) {
  return path.join(JOBS_DIR, `job-${jobId}.json`);
}

async function setJob(jobId, data) {
  try {
    await fs.writeJson(jobFile(jobId), { ...data, updatedAt: Date.now() });
  } catch (e) {
    console.error('[job] Failed to write job file:', e.message);
  }
}

async function getJob(jobId) {
  try {
    return await fs.readJson(jobFile(jobId));
  } catch {
    return null; // file not found or unreadable
  }
}

// ─── Inflate helper ───────────────────────────────────────────────────────────
async function tryInflate(buf) {
  try { return await inflateAsync(buf); }    catch {}
  try { return await inflateRawAsync(buf); } catch {}
  return null;
}

// ─── Undo PNG per-row predictor (Predictor 10–15) ────────────────────────────
function undoPNGPredictor(inflated, width, channels) {
  const rowStride = width * channels;
  const numRows   = Math.floor(inflated.length / (rowStride + 1));
  if (numRows === 0) return inflated;

  const out = Buffer.alloc(numRows * rowStride);
  for (let r = 0; r < numRows; r++) {
    const base    = r * (rowStride + 1);
    const filter  = inflated[base];
    const outOff  = r * rowStride;
    const prevOff = (r - 1) * rowStride;
    for (let i = 0; i < rowStride; i++) {
      const x  = inflated[base + 1 + i];
      const a  = i >= channels            ? out[outOff + i - channels]  : 0;
      const b  = r > 0                    ? out[prevOff + i]            : 0;
      const c  = (r > 0 && i >= channels) ? out[prevOff + i - channels] : 0;
      let v;
      switch (filter) {
        case 1: v = (x + a) & 0xFF; break;
        case 2: v = (x + b) & 0xFF; break;
        case 3: v = (x + ((a + b) >> 1)) & 0xFF; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = (x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xFF;
          break;
        }
        default: v = x;
      }
      out[outOff + i] = v;
    }
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pdfNum(obj) {
  if (!obj) return 0;
  if (typeof obj.asNumber === 'function') return obj.asNumber();
  return obj.numberValue ?? obj.value ?? 0;
}

function resolveFilter(fe) {
  if (!fe) return null;
  if (fe.encodedName) return fe.encodedName;
  if (Array.isArray(fe.array) && fe.array.length === 1)
    return fe.array[0]?.encodedName ?? null;
  return null;
}

// Returns channel count for FlateDecode images (1 = gray, 3 = rgb, null = skip)
function guessChannels(cs) {
  if (!cs) return null;
  const name = cs.encodedName;
  if (name) {
    if (name === '/DeviceGray' || name === '/CalGray') return 1;
    if (name === '/DeviceRGB'  || name === '/CalRGB')  return 3;
    return null; // CMYK raw, Indexed, etc. — skip
  }
  // PDFArray: [/ICCBased, ref] or [/CalRGB, dict]
  if (Array.isArray(cs.array) && cs.array.length >= 1) {
    const head = cs.array[0]?.encodedName;
    if (head === '/ICCBased') return 3; // almost always sRGB-tagged
    if (head === '/CalRGB')   return 3;
    if (head === '/CalGray')  return 1;
  }
  return null;
}

// ─── Core: compress every image in the PDF in parallel ───────────────────────
//
// DCTDecode (JPEG): Sharp handles RGB, Grayscale AND CMYK JPEG.
//   Applies quality reduction + downscaling, updates dict ColorSpace to match.
//
// FlateDecode (PNG-like): inflate → undo predictor → convert to JPEG via sharp.
//
// Returns { path, size } or null if nothing improved.
async function compressImages(inputPath, jpegQuality, maxDimension) {
  const pdfBytes = await fs.readFile(inputPath);

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption:     true,
      throwOnInvalidObject: false,
      updateMetadata:       false,
    });
  } catch {
    return null;
  }

  const context  = pdfDoc.context;
  const tasks    = [];
  let   replaced = 0;

  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (!obj?.dict || obj.contents === undefined) continue;
    const dict = obj.dict;

    const subtype = dict.get(PDFName.of('Subtype'));
    if (subtype?.encodedName !== '/Image') continue;

    const w = pdfNum(dict.get(PDFName.of('Width')));
    const h = pdfNum(dict.get(PDFName.of('Height')));
    if (w < 64 || h < 64) continue;

    const bpc = pdfNum(dict.get(PDFName.of('BitsPerComponent')));
    if (bpc !== 0 && bpc !== 8) continue;

    const cs         = dict.get(PDFName.of('ColorSpace'));
    const filterName = resolveFilter(dict.get(PDFName.of('Filter')));
    const imageData  = Buffer.from(obj.contents);
    const streamRef  = obj;

    // ── JPEG (DCTDecode) — handles RGB, Gray, and CMYK ────────────────────
    if (filterName === '/DCTDecode') {
      tasks.push(
        (async () => {
          try {
            const { data: compressed, info } = await sharp(imageData)
              .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: jpegQuality, chromaSubsampling: '4:2:0' })
              .toBuffer({ resolveWithObject: true });

            if (compressed.length < imageData.length) {
              streamRef.contents = new Uint8Array(compressed);
              dict.set(PDFName.of('Length'), PDFNumber.of(compressed.length));
              // Sharp always outputs sRGB or Grayscale — update dict to match
              dict.set(PDFName.of('ColorSpace'),
                PDFName.of(info.channels === 1 ? '/DeviceGray' : '/DeviceRGB'));
              if (typeof dict.delete === 'function')
                dict.delete(PDFName.of('ColorTransform'));
              replaced++;
            }
          } catch { /* sharp can't handle this particular image — skip */ }
        })()
      );

    // ── PNG-like deflate (FlateDecode) ─────────────────────────────────────
    } else if (filterName === '/FlateDecode') {
      const channels = guessChannels(cs);
      if (!channels) continue;

      let predictor = 1;
      const dp = dict.get(PDFName.of('DecodeParms'));
      if (dp && typeof dp.get === 'function') {
        const predObj = dp.get(PDFName.of('Predictor'));
        if (predObj) predictor = pdfNum(predObj);
      }

      tasks.push(
        (async () => {
          try {
            const inflated = await tryInflate(imageData);
            if (!inflated) return;

            const raw = predictor >= 10
              ? undoPNGPredictor(inflated, w, channels)
              : inflated;

            if (raw.length !== w * h * channels) return; // pixel count mismatch

            const { data: compressed, info } = await sharp(
              raw, { raw: { width: w, height: h, channels } }
            )
              .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: jpegQuality, chromaSubsampling: '4:2:0' })
              .toBuffer({ resolveWithObject: true });

            if (compressed.length < imageData.length) {
              streamRef.contents = new Uint8Array(compressed);
              dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
              if (typeof dict.delete === 'function')
                dict.delete(PDFName.of('DecodeParms'));
              dict.set(PDFName.of('ColorSpace'),
                PDFName.of(info.channels === 1 ? '/DeviceGray' : '/DeviceRGB'));
              dict.set(PDFName.of('Length'), PDFNumber.of(compressed.length));
              replaced++;
            }
          } catch { /* skip */ }
        })()
      );
    }
  }

  if (tasks.length === 0) return null;
  await Promise.all(tasks);
  if (replaced === 0) return null; // nothing shrank — avoid pointless re-save

  const savedBytes = await pdfDoc.save({ useObjectStreams: false });
  const outPath    = path.join(OUTPUT_DIR, `sharp-${uuidv4()}.pdf`);
  await fs.writeFile(outPath, savedBytes);
  return { path: outPath, size: savedBytes.length };
}

// ─── Core compression worker ──────────────────────────────────────────────────
async function runCompression(inputPath, level) {
  const originalSize = (await fs.stat(inputPath)).size;
  const outFilename  = `compressed-${uuidv4()}.pdf`;
  const outPath      = path.join(OUTPUT_DIR, outFilename);

  const cfg = {
    low:    { quality: 65, maxDim: 2400 }, // ~30-50% savings
    medium: { quality: 45, maxDim: 1800 }, // ~50-70% savings
    high:   { quality: 25, maxDim: 1200 }, // ~65-90% savings
  };
  const { quality: jpegQuality, maxDim: maxDimension } = cfg[level] || cfg.medium;

  const muOut = path.join(OUTPUT_DIR, `mu-${uuidv4()}.pdf`);

  const [imgResult, muResult] = await Promise.allSettled([
    compressImages(inputPath, jpegQuality, maxDimension),
    execFileAsync(
      'mutool',
      ['clean', '-g', '-G', '-z', '-i', '-f', inputPath, muOut],
      { timeout: 30_000 }
    )
      .then(async () => ({ path: muOut, size: (await fs.stat(muOut)).size }))
      .catch(() => null),
  ]);

  const imgVal = imgResult.status === 'fulfilled' ? imgResult.value : null;
  const muVal  = muResult.status  === 'fulfilled' ? muResult.value  : null;

  const candidates = [imgVal, muVal]
    .filter(v => v && v.size < originalSize)
    .sort((a, b) => a.size - b.size);

  if (candidates.length > 0) {
    const winner = candidates[0];
    await fs.move(winner.path, outPath, { overwrite: true });
    await Promise.allSettled(
      [imgVal, muVal]
        .filter(v => v && v.path !== winner.path)
        .map(v => fs.remove(v.path).catch(() => {}))
    );
  } else {
    await fs.copy(inputPath, outPath);
    await Promise.allSettled([
      imgVal?.path ? fs.remove(imgVal.path).catch(() => {}) : null,
      muVal?.path  ? fs.remove(muVal.path).catch(() => {})  : null,
    ]);
  }

  const newSize      = (await fs.stat(outPath)).size;
  if (newSize > originalSize) await fs.copy(inputPath, outPath);
  const finalSize    = Math.min(newSize, originalSize);
  const reductionPct = Math.round((1 - finalSize / originalSize) * 100);

  return {
    success:          true,
    file:             outFilename,
    url:              `/api/files/${outFilename}`,
    alreadyOptimized: reductionPct < 5,
    stats: [
      { label: 'Original size', value: formatBytes(originalSize) },
      { label: 'New size',      value: formatBytes(finalSize) },
      { label: 'Reduced by',   value: `${reductionPct}%` },
      { label: 'Level',        value: level.charAt(0).toUpperCase() + level.slice(1) },
    ],
  };
}

// ─── POST /api/optimize/compress ─────────────────────────────────────────────
// Returns jobId immediately; compression runs in background.
// Frontend polls GET .../status/:jobId every 3 s.
router.post('/compress', withJobId, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const { jobId } = req;
  const level     = req.body.level || 'medium';

  // Write initial state to disk BEFORE responding — survives restarts
  await setJob(jobId, { status: 'processing', createdAt: Date.now() });

  runCompression(req.file.path, level)
    .then(result => setJob(jobId, { status: 'done',  createdAt: Date.now(), ...result }))
    .catch(err   => setJob(jobId, { status: 'error', createdAt: Date.now(),
                                     error: err.message || 'Compression failed.' }));

  res.json({ jobId, status: 'processing' });
});

// ─── GET /api/optimize/compress/status/:jobId ─────────────────────────────────
router.get('/compress/status/:jobId', async (req, res) => {
  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  res.json(job);
});

// ─── POST /api/optimize/repair ───────────────────────────────────────────────
router.post('/repair', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const originalSize = (await fs.stat(req.file.path)).size;
    const bytes        = await fs.readFile(req.file.path);
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(bytes, {
        ignoreEncryption:     true,
        throwOnInvalidObject: false,
        updateMetadata:       false,
      });
    } catch {
      return res.status(422).json({ error: 'Could not repair this PDF — it may be too corrupted.' });
    }

    const outPath = await savePdf(pdfDoc, 'repaired');
    const outSize = (await fs.stat(outPath)).size;

    res.json({
      success: true,
      file:    path.basename(outPath),
      url:     `/api/files/${path.basename(outPath)}`,
      stats: [
        { label: 'Pages',         value: String(pdfDoc.getPageCount()) },
        { label: 'Original size', value: formatBytes(originalSize) },
        { label: 'Output size',   value: formatBytes(outSize) },
        { label: 'Status',        value: 'Repaired ✓' },
      ],
    });
  } catch (e) { next(e); }
});

// ─── POST /api/optimize/ocr ──────────────────────────────────────────────────
router.post('/ocr', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const Tesseract    = require('tesseract.js');
    const { fromPath } = require('pdf2pic');
    const lang         = req.body.lang || 'eng';

    const converter = fromPath(req.file.path, {
      density:      150,
      saveFilename: uuidv4(),
      savePath:     path.join(__dirname, '../../uploads'),
      format:       'png',
      width:        1240,
    });

    const pdfDoc     = await loadPdf(req.file.path);
    const totalPages = pdfDoc.getPageCount();
    const maxPages   = Math.min(totalPages, 10);

    const ocrResults = [];
    for (let i = 1; i <= maxPages; i++) {
      const imgResult = await converter(i, { responseType: 'image' });
      const { data: { text } } = await Tesseract.recognize(imgResult.path, lang);
      ocrResults.push({ page: i, text: text.trim() });
      await fs.remove(imgResult.path).catch(() => {});
    }

    const fullText = ocrResults.map(r => r.text).join('\n\n--- Page Break ---\n\n');

    res.json({
      success:        true,
      totalPages,
      processedPages: maxPages,
      results:        ocrResults,
      fullText,
      stats: [
        { label: 'Pages processed',  value: `${maxPages} / ${totalPages}` },
        { label: 'Characters found', value: fullText.replace(/\s/g, '').length.toLocaleString() },
        { label: 'Language',         value: lang.toUpperCase() },
      ],
    });
  } catch (e) { next(e); }
});

module.exports = router;
