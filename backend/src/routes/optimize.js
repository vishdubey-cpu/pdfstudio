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

// ─── In-memory job store (purge stale entries every 10 min) ──────────────────
const compressionJobs = new Map();
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of compressionJobs)
    if (job.createdAt < cutoff) compressionJobs.delete(id);
}, 10 * 60 * 1000);

// ─── Inflate helper: tries zlib envelope first, then raw deflate ─────────────
async function tryInflate(buf) {
  try { return await inflateAsync(buf); }    catch {}
  try { return await inflateRawAsync(buf); } catch {}
  return null;
}

// ─── Undo PNG per-row predictor (Predictor 10–15) ────────────────────────────
// After zlib decompression, each row starts with a 1-byte PNG filter type.
// We must undo this before feeding raw pixels to sharp.
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
      const a  = i >= channels           ? out[outOff + i - channels]  : 0; // left
      const b  = r > 0                   ? out[prevOff + i]            : 0; // above
      const c  = (r > 0 && i >= channels)? out[prevOff + i - channels] : 0; // upper-left

      let v;
      switch (filter) {
        case 1: v = (x + a) & 0xFF; break;
        case 2: v = (x + b) & 0xFF; break;
        case 3: v = (x + ((a + b) >> 1)) & 0xFF; break;
        case 4: {
          const p  = a + b - c;
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

// ─── Extract a number from a pdf-lib object ───────────────────────────────────
function pdfNum(obj) {
  if (!obj) return 0;
  if (typeof obj.asNumber === 'function') return obj.asNumber();
  return obj.numberValue ?? obj.value ?? 0;
}

// ─── Resolve the filter name from a pdf-lib dict entry ───────────────────────
function resolveFilter(filterEntry) {
  if (!filterEntry) return null;
  if (filterEntry.encodedName) return filterEntry.encodedName;
  // PDFArray with a single entry
  if (Array.isArray(filterEntry.array) && filterEntry.array.length === 1)
    return filterEntry.array[0]?.encodedName ?? null;
  return null;
}

// ─── Core: compress every image in the PDF in parallel ───────────────────────
// Handles:
//   • DCTDecode  (JPEG)  → lower quality + downscale with sharp
//   • FlateDecode (PNG-like) → inflate → undo predictor → JPEG via sharp
//
// Returns { path, size } or null if nothing could be improved.
async function compressImages(inputPath, jpegQuality, maxDimension) {
  const pdfBytes = await fs.readFile(inputPath);

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption:   true,
      throwOnInvalidObject: false,
      updateMetadata:     false,
    });
  } catch {
    return null;
  }

  const context  = pdfDoc.context;
  const tasks    = [];
  let   replaced = 0; // track how many images were actually replaced

  for (const [, obj] of context.enumerateIndirectObjects()) {
    // Only look at raw streams that have a dict
    if (!obj?.dict || obj.contents === undefined) continue;
    const dict = obj.dict;

    // Must be an Image XObject
    const subtype = dict.get(PDFName.of('Subtype'));
    if (subtype?.encodedName !== '/Image') continue;

    // Minimum pixel size — skip tiny icons / bullets
    const w = pdfNum(dict.get(PDFName.of('Width')));
    const h = pdfNum(dict.get(PDFName.of('Height')));
    if (w < 64 || h < 64) continue;

    // Skip CMYK — resampling would require a colour-space conversion
    const cs = dict.get(PDFName.of('ColorSpace'));
    if (cs?.encodedName === '/DeviceCMYK') continue;

    // Only 8-bit images (covers almost all real-world PDFs)
    const bpc = pdfNum(dict.get(PDFName.of('BitsPerComponent')));
    if (bpc !== 0 && bpc !== 8) continue;

    const filterName = resolveFilter(dict.get(PDFName.of('Filter')));
    const imageData  = Buffer.from(obj.contents);
    const streamRef  = obj; // mutable reference

    // ── JPEG images: recompress at lower quality, optionally downscale ─────
    if (filterName === '/DCTDecode') {
      tasks.push(
        sharp(imageData)
          .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: jpegQuality, chromaSubsampling: '4:2:0', mozjpeg: false })
          .toBuffer()
          .then(compressed => {
            if (compressed.length < imageData.length) {
              streamRef.contents = new Uint8Array(compressed);
              dict.set(PDFName.of('Length'), PDFNumber.of(compressed.length));
              replaced++;
            }
          })
          .catch(() => {})
      );

    // ── PNG-like (FlateDecode) images: inflate → raw pixels → JPEG ────────
    } else if (filterName === '/FlateDecode') {
      // Only handle simple named color spaces we know the channel count for
      const csName = cs?.encodedName ?? '';
      if (csName !== '/DeviceRGB' && csName !== '/DeviceGray') continue;
      const channels = csName === '/DeviceGray' ? 1 : 3;

      // Read predictor from DecodeParms
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

            // Undo PNG row-filter predictor if present
            let raw = predictor >= 10
              ? undoPNGPredictor(inflated, w, channels)
              : inflated;

            // Sanity-check pixel buffer size
            if (raw.length !== w * h * channels) return;

            const compressed = await sharp(raw, { raw: { width: w, height: h, channels } })
              .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: jpegQuality, chromaSubsampling: '4:2:0', mozjpeg: false })
              .toBuffer();

            // Only replace if JPEG is smaller than original FlateDecode blob
            if (compressed.length < imageData.length) {
              streamRef.contents = new Uint8Array(compressed);
              // Switch filter from FlateDecode → DCTDecode
              dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
              // Remove FlateDecode decode parameters (predictor etc.)
              if (typeof dict.delete === 'function')
                dict.delete(PDFName.of('DecodeParms'));
              dict.set(PDFName.of('Length'), PDFNumber.of(compressed.length));
              replaced++;
            }
          } catch { /* skip unprocessable images */ }
        })()
      );
    }
  }

  // Nothing to process — bail out early
  if (tasks.length === 0) return null;

  await Promise.all(tasks);

  // If no image got smaller, don't waste time saving
  if (replaced === 0) return null;

  const savedBytes = await pdfDoc.save({ useObjectStreams: false });
  const outPath    = path.join(OUTPUT_DIR, `sharp-${uuidv4()}.pdf`);
  await fs.writeFile(outPath, savedBytes);
  return { path: outPath, size: savedBytes.length };
}

// ─── Core compression worker ─────────────────────────────────────────────────
// Runs image compression (sharp) + structural pass (mutool) in parallel
// then picks the smallest result that beats the original.
async function runCompression(inputPath, level) {
  const originalSize = (await fs.stat(inputPath)).size;
  const outFilename  = `compressed-${uuidv4()}.pdf`;
  const outPath      = path.join(OUTPUT_DIR, outFilename);

  // Per-level tuning
  // Low    → quality 65, max 2400 px  (fast, modest savings)
  // Medium → quality 45, max 1800 px  (balanced)
  // High   → quality 25, max 1200 px  (max compression — 60-90% savings on image PDFs)
  const cfg = {
    low:    { quality: 65, maxDim: 2400 },
    medium: { quality: 45, maxDim: 1800 },
    high:   { quality: 25, maxDim: 1200 },
  };
  const { quality: jpegQuality, maxDim: maxDimension } =
    cfg[level] || cfg.medium;

  const muOut = path.join(OUTPUT_DIR, `mu-${uuidv4()}.pdf`);

  // Run both passes in parallel: sharp image recompression + mutool cleanup
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

  // Pick the candidate that actually shrank the file the most
  const candidates = [imgVal, muVal]
    .filter(v => v && v.size < originalSize)
    .sort((a, b) => a.size - b.size);

  if (candidates.length > 0) {
    const winner = candidates[0];
    await fs.move(winner.path, outPath, { overwrite: true });
    // Clean up losers
    await Promise.allSettled(
      [imgVal, muVal]
        .filter(v => v && v.path !== winner.path)
        .map(v => fs.remove(v.path).catch(() => {}))
    );
  } else {
    // Nothing helped — copy original
    await fs.copy(inputPath, outPath);
    await Promise.allSettled([
      imgVal?.path ? fs.remove(imgVal.path).catch(() => {}) : null,
      muVal?.path  ? fs.remove(muVal.path).catch(() => {})  : null,
    ]);
  }

  // Final safety: never serve a file larger than the original
  const newSize = (await fs.stat(outPath)).size;
  if (newSize > originalSize) await fs.copy(inputPath, outPath);

  const finalSize    = Math.min(newSize, originalSize);
  const reductionPct = Math.round((1 - finalSize / originalSize) * 100);

  return {
    success:         true,
    file:            outFilename,
    url:             `/api/files/${outFilename}`,
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
// Returns a jobId immediately; processing happens in the background.
// Frontend polls GET /api/optimize/compress/status/:jobId every 3 s.
router.post('/compress', withJobId, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const { jobId }  = req;
  const level      = req.body.level || 'medium';
  const inputPath  = req.file.path;

  compressionJobs.set(jobId, { status: 'processing', createdAt: Date.now() });

  runCompression(inputPath, level)
    .then(result => {
      compressionJobs.set(jobId, { status: 'done', createdAt: Date.now(), ...result });
    })
    .catch(err => {
      compressionJobs.set(jobId, {
        status:    'error',
        createdAt: Date.now(),
        error:     err.message || 'Compression failed.',
      });
    });

  res.json({ jobId, status: 'processing' });
});

// ─── GET /api/optimize/compress/status/:jobId ────────────────────────────────
router.get('/compress/status/:jobId', (req, res) => {
  const job = compressionJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  res.json(job);
});

// ─── POST /api/optimize/repair ───────────────────────────────────────────────
router.post('/repair', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const originalSize = (await fs.stat(req.file.path)).size;
    const bytes = await fs.readFile(req.file.path);
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
    const lang = req.body.lang || 'eng';

    const converter = fromPath(req.file.path, {
      density:      150,
      saveFilename: uuidv4(),
      savePath:     path.join(__dirname, '../../uploads'),
      format:       'png',
      width:        1240,
    });

    const pdfDoc    = await loadPdf(req.file.path);
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
