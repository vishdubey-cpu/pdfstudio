const express = require('express');
const router = express.Router();
const { PDFDocument, degrees, rgb, StandardFonts, PDFString } = require('pdf-lib');
const path = require('path');
const fs = require('fs-extra');
const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf } = require('../services/pdfUtils');

// Helper: parse hex color to rgb 0-1 values
function hexToRgb(hex = '#000000') {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return rgb(r, g, b);
}

// ─── POST /api/edit/watermark ─────────────────────────────────────────────────
// Body: file, text (required), color (#hex), opacity (0-1), position (center|top-left|top-right|bottom-left|bottom-right), fontSize, rotation
router.post('/watermark', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.body.text) return res.status(400).json({ error: 'Watermark text is required.' });

    const text = req.body.text;
    const color = hexToRgb(req.body.color || '#000000');
    const opacity = parseFloat(req.body.opacity ?? 0.3);
    const fontSize = parseInt(req.body.fontSize) || 48;
    const rotation = parseInt(req.body.rotation) || -45;
    const position = req.body.position || 'center';

    const pdfDoc = await loadPdf(req.file.path);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();

    for (const page of pages) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const textHeight = font.heightAtSize(fontSize);

      let x = (width - textWidth) / 2;
      let y = (height - textHeight) / 2;

      if (position === 'top-left')     { x = 40; y = height - textHeight - 40; }
      if (position === 'top-right')    { x = width - textWidth - 40; y = height - textHeight - 40; }
      if (position === 'bottom-left')  { x = 40; y = 40; }
      if (position === 'bottom-right') { x = width - textWidth - 40; y = 40; }

      page.drawText(text, {
        x, y,
        size: fontSize,
        font,
        color,
        opacity,
        rotate: degrees(rotation),
      });
    }

    const outPath = await savePdf(pdfDoc, 'watermarked');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/edit/page-numbers ─────────────────────────────────────────────
// Body: file, position (bottom-center|bottom-left|bottom-right|top-center), startAt, prefix, fontSize, color
router.post('/page-numbers', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const position = req.body.position || 'bottom-center';
    const startAt = parseInt(req.body.startAt) || 1;
    const prefix = req.body.prefix || '';
    const suffix = req.body.suffix || '';
    const fontSize = parseInt(req.body.fontSize) || 12;
    const color = hexToRgb(req.body.color || '#000000');

    const pdfDoc = await loadPdf(req.file.path);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    pages.forEach((page, i) => {
      const { width, height } = page.getSize();
      const pageLabel = `${prefix}${i + startAt}${suffix}`;
      const textWidth = font.widthOfTextAtSize(pageLabel, fontSize);
      const margin = 20;

      let x = (width - textWidth) / 2;
      let y = margin;

      if (position === 'bottom-left')  { x = margin; }
      if (position === 'bottom-right') { x = width - textWidth - margin; }
      if (position === 'top-center')   { y = height - margin - fontSize; }
      if (position === 'top-left')     { x = margin; y = height - margin - fontSize; }
      if (position === 'top-right')    { x = width - textWidth - margin; y = height - margin - fontSize; }

      page.drawText(pageLabel, { x, y, size: fontSize, font, color });
    });

    const outPath = await savePdf(pdfDoc, 'numbered');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/edit/crop ──────────────────────────────────────────────────────
// Body: file, x, y, width, height (all in points from bottom-left), pages (optional)
router.post('/crop', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const cropBox = {
      x: parseFloat(req.body.x) || 0,
      y: parseFloat(req.body.y) || 0,
      width: parseFloat(req.body.width),
      height: parseFloat(req.body.height),
    };

    if (!cropBox.width || !cropBox.height)
      return res.status(400).json({ error: 'width and height are required.' });

    const pdfDoc = await loadPdf(req.file.path);
    const targetPages = req.body.pages
      ? JSON.parse(req.body.pages).map(n => n - 1)
      : pdfDoc.getPageIndices();

    pdfDoc.getPages().forEach((page, i) => {
      if (targetPages.includes(i)) {
        page.setCropBox(cropBox.x, cropBox.y, cropBox.width, cropBox.height);
      }
    });

    const outPath = await savePdf(pdfDoc, 'cropped');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/edit/add-text ──────────────────────────────────────────────────
// Body: file, text, x, y, page (1-indexed), fontSize, color
router.post('/add-text', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const { text, x, y, fontSize = 14, color: colorHex = '#000000', page: pageNum = 1 } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required.' });

    const pdfDoc = await loadPdf(req.file.path);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();
    const page = pages[parseInt(pageNum) - 1];
    if (!page) return res.status(400).json({ error: 'Invalid page number.' });

    page.drawText(text, {
      x: parseFloat(x) || 50,
      y: parseFloat(y) || 50,
      size: parseInt(fontSize),
      font,
      color: hexToRgb(colorHex),
    });

    const outPath = await savePdf(pdfDoc, 'edited');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

module.exports = router;
