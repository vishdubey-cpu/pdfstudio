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

// ─── POST /api/optimize/compress ─────────────────────────────────────────────
router.post('/compress', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const level = req.body.level || 'medium';
    // Ghostscript PDFSETTINGS: /screen=72dpi(smallest), /ebook=150dpi(balanced), /printer=300dpi(quality)
    const gsSettingsMap = { low: '/printer', medium: '/ebook', high: '/screen' };
    const pdfsetting = gsSettingsMap[level] || '/ebook';

    const originalSize = (await fs.stat(req.file.path)).size;
    const outFilename = `compressed-${uuidv4()}.pdf`;
    const outPath = path.join(OUTPUT_DIR, outFilename);

    // Step 1: Ghostscript — best for image-heavy PDFs
    await execFileAsync('gs', [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=${pdfsetting}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      `-sOutputFile=${outPath}`,
      req.file.path,
    ]);
    let newSize = (await fs.stat(outPath)).size;

    // Step 2: If Ghostscript made it BIGGER, try qpdf lossless stream compression
    if (newSize >= originalSize) {
      await fs.remove(outPath);
      try {
        await execFileAsync('qpdf', [
          '--compress-streams=y', '--object-streams=generate',
          req.file.path, outPath,
        ]);
        newSize = (await fs.stat(outPath)).size;
      } catch (_) { newSize = originalSize + 1; } // force fallback below
    }

    // Step 3: If still bigger or equal, just return the original unchanged
    if (newSize >= originalSize) {
      await fs.copy(req.file.path, outPath);
      newSize = originalSize;
    }

    const reductionPct = Math.round((1 - newSize / originalSize) * 100);
    const alreadyOptimized = reductionPct === 0;

    res.json({
      success: true,
      file: outFilename,
      url: `/api/files/${outFilename}`,
      alreadyOptimized,
      stats: [
        { label: 'Original size', value: formatBytes(originalSize) },
        { label: 'New size',      value: formatBytes(newSize) },
        { label: 'Reduced by',   value: `${reductionPct}%` },
        { label: 'Level',        value: level.charAt(0).toUpperCase() + level.slice(1) },
      ],
    });
  } catch (e) { next(e); }
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
