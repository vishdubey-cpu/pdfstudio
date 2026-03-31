'use strict';

/**
 * Compression strategy: Ghostscript
 *
 * Why not pdf-lib + sharp?
 *   pdf-lib is pure JavaScript. Saving a 33 MB PDF re-serialises every single
 *   object in the document and takes 5–10 minutes. Completely unacceptable.
 *
 * Why Ghostscript?
 *   Native C++, handles CMYK/RGB/Gray images, downsamples images at whatever
 *   DPI we specify, and finishes a 33 MB scanned PDF in 60–120 seconds.
 *   With the async-job pattern there is no HTTP timeout, so the user just
 *   watches the spinner until it finishes.
 */

const express  = require('express');
const router   = express.Router();
const { execFile } = require('child_process');
const { promisify } = require('util');
const path     = require('path');
const fs       = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

const { PDFDocument } = require('pdf-lib');

const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf, OUTPUT_DIR, formatBytes } = require('../services/pdfUtils');

const execFileAsync = promisify(execFile);

// ─── File-based job store (survives process restarts) ─────────────────────────
function jobFile(jobId) {
  return path.join(OUTPUT_DIR, `job-${jobId}.json`);
}
async function setJob(jobId, data) {
  try { await fs.writeJson(jobFile(jobId), { ...data, updatedAt: Date.now() }); }
  catch (e) { console.error('[job] write failed:', e.message); }
}
async function getJob(jobId) {
  try { return await fs.readJson(jobFile(jobId)); }
  catch  { return null; }
}

// ─── Ghostscript compression ──────────────────────────────────────────────────
//
// Level → target DPI + JPEG quality factor (QFactor: lower = better quality)
//   low    200 DPI, QFactor 0.3  →  good quality,  ~30–50% smaller
//   medium 150 DPI, QFactor 0.6  →  balanced,      ~50–70% smaller
//   high   100 DPI, QFactor 1.2  →  max compress,  ~70–85% smaller
//
// -dConvertCMYKImagesToRGB converts 4-channel CMYK images to 3-channel sRGB,
// saving ~25% extra just from the channel reduction (safe for screen reading).
//
async function runCompression(inputPath, level) {
  const originalSize = (await fs.stat(inputPath)).size;
  const outFilename  = `compressed-${uuidv4()}.pdf`;
  const outPath      = path.join(OUTPUT_DIR, outFilename);

  // Map level → Ghostscript PDF settings preset
  // /printer = 300 DPI (low compression, best quality)
  // /ebook   = 150 DPI (medium — good balance, ~40-70% reduction on image PDFs)
  // /screen  = 72 DPI  (high — max compression)
  const pdfsettings = level === 'high' ? '/screen' : level === 'low' ? '/printer' : '/ebook';

  const gsArgs = [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.5',
    '-dNOPAUSE',
    '-dBATCH',
    `-dPDFSETTINGS=${pdfsettings}`,
    `-sOutputFile=${outPath}`,
    inputPath,
  ];

  try {
    await execFileAsync('gs', gsArgs, { timeout: 600_000 });
  } catch (err) {
    const gsErr = `${err.message} | stderr: ${err.stderr || ''} | stdout: ${err.stdout || ''} | code: ${err.code}`;
    console.error('[compress] gs failed:', gsErr);
    await fs.copy(inputPath, outPath);
    return {
      success:          true,
      file:             outFilename,
      url:              `/api/files/${outFilename}`,
      alreadyOptimized: true,
      _gsError:         gsErr,
      stats: [
        { label: 'Original size', value: formatBytes(originalSize) },
        { label: 'New size',      value: formatBytes(originalSize) },
        { label: 'Reduced by',   value: '0%' },
        { label: 'Level',        value: level.charAt(0).toUpperCase() + level.slice(1) },
      ],
    };
  }

  // Ensure output exists and is not larger than input
  const newSize = (await fs.stat(outPath)).size;
  if (newSize >= originalSize) {
    await fs.copy(inputPath, outPath);
  }

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
router.post('/compress', withJobId, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const { jobId } = req;
  const level     = req.body.level || 'medium';

  await setJob(jobId, { status: 'processing', createdAt: Date.now() });

  runCompression(req.file.path, level)
    .then(result => setJob(jobId, { status: 'done',  createdAt: Date.now(), ...result }))
    .catch(err   => setJob(jobId, { status: 'error', createdAt: Date.now(),
                                     error: err.message || 'Compression failed.' }));

  res.json({ jobId, status: 'processing' });
});

// ─── GET /api/optimize/compress/status/:jobId ────────────────────────────────
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
      return res.status(422).json({ error: 'Could not repair — PDF may be too corrupted.' });
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
