const express = require('express');
const router = express.Router();
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf, OUTPUT_DIR } = require('../services/pdfUtils');

// ─── POST /api/optimize/compress ─────────────────────────────────────────────
// Body: file, level: 'low' | 'medium' | 'high'
// Strategy: re-encode embedded images with sharp at lower quality
router.post('/compress', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const level = req.body.level || 'medium';
    const qualityMap = { low: 85, medium: 60, high: 35 };
    const quality = qualityMap[level] || 60;

    const pdfDoc = await loadPdf(req.file.path);

    // Re-embed images at lower quality
    const context = pdfDoc.context;
    const enumeratedIndirectObjects = context.enumerateIndirectObjects();

    for (const [ref, object] of enumeratedIndirectObjects) {
      try {
        if (object.constructor.name === 'PDFRawStream') {
          const dict = object.dict;
          const subtype = dict.get && dict.get(require('pdf-lib').PDFName.of('Subtype'));
          if (subtype && subtype.toString() === '/Image') {
            const colorSpace = dict.get(require('pdf-lib').PDFName.of('ColorSpace'));
            const bitsPerComponent = dict.get(require('pdf-lib').PDFName.of('BitsPerComponent'));

            if (bitsPerComponent && colorSpace) {
              // Attempt to recompress image data via sharp
              try {
                const compressedImg = await sharp(Buffer.from(object.contents))
                  .jpeg({ quality })
                  .toBuffer();
                // Replace stream contents
                object.contents = new Uint8Array(compressedImg);
              } catch (_) {
                // Skip images that sharp can't process
              }
            }
          }
        }
      } catch (_) { /* skip objects that fail */ }
    }

    const outPath = await savePdf(pdfDoc, 'compressed');
    const originalSize = (await fs.stat(req.file.path)).size;
    const newSize = (await fs.stat(outPath)).size;

    res.json({
      success: true,
      file: path.basename(outPath),
      url: `/api/files/${path.basename(outPath)}`,
      originalSize,
      newSize,
      reduction: `${Math.round((1 - newSize / originalSize) * 100)}%`,
    });
  } catch (e) { next(e); }
});

// ─── POST /api/optimize/repair ────────────────────────────────────────────────
// Attempts to load the PDF with ignoreEncryption + permissive options, then re-save
router.post('/repair', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

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
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/optimize/ocr ───────────────────────────────────────────────────
// Requires Tesseract — converts PDF pages to images, runs OCR, returns text
router.post('/ocr', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    // Tesseract.js — runs in Node, no system dependency
    const Tesseract = require('tesseract.js');
    const { fromPath } = require('pdf2pic');
    const lang = req.body.lang || 'eng';

    // Convert PDF pages to images
    const converter = fromPath(req.file.path, {
      density: 150,
      saveFilename: uuidv4(),
      savePath: path.join(__dirname, '../../uploads'),
      format: 'png',
      width: 1240,
    });

    const pdfDoc = await loadPdf(req.file.path);
    const totalPages = pdfDoc.getPageCount();
    const maxPages = Math.min(totalPages, 10); // cap at 10 pages for free tier

    const ocrResults = [];
    for (let i = 1; i <= maxPages; i++) {
      const imgResult = await converter(i, { responseType: 'image' });
      const { data: { text } } = await Tesseract.recognize(imgResult.path, lang);
      ocrResults.push({ page: i, text: text.trim() });
      await fs.remove(imgResult.path).catch(() => {});
    }

    res.json({
      success: true,
      totalPages,
      processedPages: maxPages,
      results: ocrResults,
      fullText: ocrResults.map(r => r.text).join('\n\n--- Page Break ---\n\n'),
    });
  } catch (e) { next(e); }
});

module.exports = router;
