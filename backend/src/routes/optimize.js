const express = require('express');
const router = express.Router();
const { PDFDocument } = require('pdf-lib');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf, OUTPUT_DIR, formatBytes } = require('../services/pdfUtils');

const execFileAsync = promisify(execFile);

// ─── In-memory job store for async compression ────────────────────────────────
// Each job: { status: 'processing'|'done'|'error', createdAt, ...result }
const compressionJobs = new Map();

// Purge jobs older than 2 hours every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of compressionJobs) {
    if (job.createdAt < cutoff) compressionJobs.delete(id);
  }
}, 10 * 60 * 1000);

// ─── Core compression worker (runs async, not in request lifecycle) ────────────
async function runCompression(inputPath, level) {
  const outFilename = `compressed-${uuidv4()}.pdf`;
  const outPath = path.join(OUTPUT_DIR, outFilename);
  const originalSize = (await fs.stat(inputPath)).size;

  // mutool: fast structure/stream optimization, no image resampling (~1-3 sec)
  const mutoolFlags = ['-g', '-G', '-z', '-i', '-f'];

  // Ghostscript settings — the only tool that resamples embedded images
  // -dNumRenderingThreads=4 : use all available cores
  // -dMaxBitmap=500000000   : 500 MB RAM cache to avoid slow disk paging
  const GS_LEVELS = {
    low:    { pdfsettings: '/printer', dpi: 200 }, // 200 DPI, best quality, ~20-40% reduction
    medium: { pdfsettings: '/ebook',   dpi: 150 }, // 150 DPI, balanced,    ~40-60% reduction
    high:   { pdfsettings: '/screen',  dpi: 96  }, // 96 DPI,  smallest,    ~60-80% reduction
  };
  const gs = GS_LEVELS[level] || GS_LEVELS.medium;

  function ghostscriptArgs(outputFile) {
    return [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=${gs.pdfsettings}`,
      '-dNOPAUSE', '-dQUIET', '-dBATCH',
      '-dNumRenderingThreads=4',
      '-dMaxBitmap=500000000',
      '-dDownsampleColorImages=true',
      '-dDownsampleGrayImages=true',
      '-dDownsampleMonoImages=true',
      '-dColorImageDownsampleType=/Bicubic',
      '-dGrayImageDownsampleType=/Bicubic',
      '-dMonoImageDownsampleType=/Subsample',
      `-dColorImageResolution=${gs.dpi}`,
      `-dGrayImageResolution=${gs.dpi}`,
      `-dMonoImageResolution=${gs.dpi}`,
      `-sOutputFile=${outputFile}`,
      inputPath,
    ];
  }

  // Run Ghostscript + mutool in parallel for all levels.
  // No timeout — this runs in background so large files can take as long as needed.
  const gsOut = path.join(OUTPUT_DIR, `gs-${uuidv4()}.pdf`);
  const muOut = path.join(OUTPUT_DIR, `mu-${uuidv4()}.pdf`);

  const [gsResult, muResult] = await Promise.allSettled([
    execFileAsync('gs', ghostscriptArgs(gsOut), { maxBuffer: 10 * 1024 * 1024 })
      .then(async () => ({ path: gsOut, size: (await fs.stat(gsOut)).size })),
    execFileAsync('mutool', ['clean', ...mutoolFlags, inputPath, muOut])
      .then(async () => ({ path: muOut, size: (await fs.stat(muOut)).size })),
  ]);

  const candidates = [gsResult, muResult]
    .filter(r => r.status === 'fulfilled' && r.value.size < originalSize)
    .map(r => r.value)
    .sort((a, b) => a.size - b.size);

  if (candidates.length > 0) {
    await fs.move(candidates[0].path, outPath, { overwrite: true });
    await Promise.allSettled(
      [gsOut, muOut].filter(p => p !== candidates[0].path).map(p => fs.remove(p))
    );
  } else {
    // Nothing reduced the size — return original unchanged
    await fs.copy(inputPath, outPath);
    await Promise.allSettled([fs.remove(gsOut), fs.remove(muOut)]);
  }

  const newSize = (await fs.stat(outPath)).size;
  if (newSize > originalSize) await fs.copy(inputPath, outPath);
  const finalSize = Math.min(newSize, originalSize);
  const reductionPct = Math.round((1 - finalSize / originalSize) * 100);

  return {
    success: true,
    file: outFilename,
    url: `/api/files/${outFilename}`,
    alreadyOptimized: reductionPct === 0,
    stats: [
      { label: 'Original size', value: formatBytes(originalSize) },
      { label: 'New size',      value: formatBytes(finalSize) },
      { label: 'Reduced by',   value: `${reductionPct}%` },
      { label: 'Level',        value: level.charAt(0).toUpperCase() + level.slice(1) },
    ],
  };
}

// ─── POST /api/optimize/compress ─────────────────────────────────────────────
// Returns { jobId, status: 'processing' } immediately — no timeout risk.
router.post('/compress', withJobId, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const jobId = req.jobId;
  const level = req.body.level || 'medium';

  compressionJobs.set(jobId, { status: 'processing', createdAt: Date.now() });

  // Fire and forget — compression runs in background
  runCompression(req.file.path, level)
    .then(result => {
      compressionJobs.set(jobId, { status: 'done', createdAt: Date.now(), ...result });
    })
    .catch(err => {
      compressionJobs.set(jobId, {
        status: 'error',
        createdAt: Date.now(),
        error: err.message || 'Compression failed.',
      });
    });

  // Respond immediately — client will poll /compress/status/:jobId
  res.json({ jobId, status: 'processing' });
});

// ─── GET /api/optimize/compress/status/:jobId ─────────────────────────────────
router.get('/compress/status/:jobId', (req, res) => {
  const job = compressionJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  res.json(job);
});

// ─── POST /api/optimize/repair ────────────────────────────────────────────────
router.post('/repair', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const originalSize = (await fs.stat(req.file.path)).size;
    const bytes = await fs.readFile(req.file.path);
    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        updateMetadata: false,
      });
    } catch (loadErr) {
      return res.status(422).json({ error: 'Could not repair this PDF — it may be too corrupted.' });
    }

    const outPath = await savePdf(pdfDoc, 'repaired');
    const outSize = (await fs.stat(outPath)).size;

    res.json({
      success: true,
      file: path.basename(outPath),
      url: `/api/files/${path.basename(outPath)}`,
      stats: [
        { label: 'Pages',         value: String(pdfDoc.getPageCount()) },
        { label: 'Original size', value: formatBytes(originalSize) },
        { label: 'Output size',   value: formatBytes(outSize) },
        { label: 'Status',        value: 'Repaired ✓' },
      ],
    });
  } catch (e) { next(e); }
});

// ─── POST /api/optimize/ocr ───────────────────────────────────────────────────
router.post('/ocr', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const Tesseract = require('tesseract.js');
    const { fromPath } = require('pdf2pic');
    const lang = req.body.lang || 'eng';

    const converter = fromPath(req.file.path, {
      density: 150,
      saveFilename: uuidv4(),
      savePath: path.join(__dirname, '../../uploads'),
      format: 'png',
      width: 1240,
    });

    const pdfDoc = await loadPdf(req.file.path);
    const totalPages = pdfDoc.getPageCount();
    const maxPages = Math.min(totalPages, 10);

    const ocrResults = [];
    for (let i = 1; i <= maxPages; i++) {
      const imgResult = await converter(i, { responseType: 'image' });
      const { data: { text } } = await Tesseract.recognize(imgResult.path, lang);
      ocrResults.push({ page: i, text: text.trim() });
      await fs.remove(imgResult.path).catch(() => {});
    }

    const fullText = ocrResults.map(r => r.text).join('\n\n--- Page Break ---\n\n');

    res.json({
      success: true,
      totalPages,
      processedPages: maxPages,
      results: ocrResults,
      fullText,
      stats: [
        { label: 'Pages processed', value: `${maxPages} / ${totalPages}` },
        { label: 'Characters found', value: fullText.replace(/\s/g, '').length.toLocaleString() },
        { label: 'Language', value: lang.toUpperCase() },
      ],
    });
  } catch (e) { next(e); }
});

module.exports = router;
