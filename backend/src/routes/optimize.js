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

    const originalSize = (await fs.stat(req.file.path)).size;
    const outFilename = `compressed-${uuidv4()}.pdf`;
    const outPath = path.join(OUTPUT_DIR, outFilename);

    // mutool clean flags: -g=garbage collect, -G=aggressive GC, -z=compress streams,
    // -i=compress object streams, -f=compress fonts
    const mutoolFlags = level === 'high' ? ['-g', '-G', '-z', '-i', '-f'] : ['-g', '-z', '-i', '-f'];

    if (level === 'high') {
      // High: run mutool and Ghostscript in parallel, use whichever is smaller
      const gsOut  = path.join(OUTPUT_DIR, `gs-${uuidv4()}.pdf`);
      const muOut  = path.join(OUTPUT_DIR, `mu-${uuidv4()}.pdf`);

      const [gsResult, muResult] = await Promise.allSettled([
        execFileAsync('gs', [
          '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/screen',
          '-dNOPAUSE', '-dQUIET', '-dBATCH', `-sOutputFile=${gsOut}`, req.file.path,
        ]).then(async () => ({ path: gsOut, size: (await fs.stat(gsOut)).size })),
        execFileAsync('mutool', ['clean', ...mutoolFlags, req.file.path, muOut])
          .then(async () => ({ path: muOut, size: (await fs.stat(muOut)).size })),
      ]);

      const candidates = [gsResult, muResult]
        .filter(r => r.status === 'fulfilled' && r.value.size < originalSize)
        .map(r => r.value)
        .sort((a, b) => a.size - b.size);

      if (candidates.length > 0) {
        await fs.move(candidates[0].path, outPath, { overwrite: true });
        // clean up the loser
        await Promise.allSettled(
          [gsOut, muOut].filter(p => p !== candidates[0].path).map(p => fs.remove(p))
        );
      } else {
        // Neither helped — return original
        await fs.copy(req.file.path, outPath);
        await Promise.allSettled([fs.remove(gsOut), fs.remove(muOut)]);
      }
    } else {
      // Low / Medium: mutool only — direct PDF structure optimisation, ~10x faster than Ghostscript
      try {
        await execFileAsync('mutool', ['clean', ...mutoolFlags, req.file.path, outPath]);
      } catch (_) {
        await fs.copy(req.file.path, outPath); // fallback: return original
      }
    }

    const newSize = (await fs.stat(outPath)).size;
    // Guarantee we never return something larger than the original
    if (newSize > originalSize) await fs.copy(req.file.path, outPath);
    const finalSize = Math.min(newSize, originalSize);

    const reductionPct = Math.round((1 - finalSize / originalSize) * 100);

    res.json({
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
