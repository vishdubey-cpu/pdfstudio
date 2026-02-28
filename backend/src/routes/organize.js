const express = require('express');
const router = express.Router();
const { PDFDocument } = require('pdf-lib');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf, OUTPUT_DIR } = require('../services/pdfUtils');

// ─── POST /api/organize/merge ─────────────────────────────────────────────────
// Body: multipart, files[] (multiple PDFs), order[] optional
router.post('/merge', withJobId, upload.array('files', 20), async (req, res, next) => {
  try {
    if (!req.files || req.files.length < 2)
      return res.status(400).json({ error: 'Please upload at least 2 PDF files.' });

    // Optional order param: comma-separated indices
    let order = req.files.map((_, i) => i);
    if (req.body.order) {
      try { order = JSON.parse(req.body.order); } catch (_) {}
    }

    const merged = await PDFDocument.create();

    for (const idx of order) {
      const file = req.files[idx];
      if (!file) continue;
      const srcDoc = await loadPdf(file.path);
      const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }

    const outPath = await savePdf(merged, 'merged');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/split ─────────────────────────────────────────────────
// Body: file (single PDF), ranges: JSON array of {start, end} (1-indexed) OR mode: 'each'
router.post('/split', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const srcDoc = await loadPdf(req.file.path);
    const totalPages = srcDoc.getPageCount();
    const mode = req.body.mode || 'each';
    let ranges = [];

    if (mode === 'each') {
      ranges = Array.from({ length: totalPages }, (_, i) => ({ start: i, end: i }));
    } else if (req.body.ranges) {
      const raw = JSON.parse(req.body.ranges);
      // Convert 1-indexed to 0-indexed
      ranges = raw.map(r => ({ start: r.start - 1, end: r.end - 1 }));
    } else {
      return res.status(400).json({ error: 'Provide ranges or mode=each' });
    }

    const outputFiles = [];
    for (let i = 0; i < ranges.length; i++) {
      const { start, end } = ranges[i];
      const newDoc = await PDFDocument.create();
      const pageIndices = [];
      for (let p = start; p <= end && p < totalPages; p++) pageIndices.push(p);
      const pages = await newDoc.copyPages(srcDoc, pageIndices);
      pages.forEach(p => newDoc.addPage(p));
      const outPath = await savePdf(newDoc, `split-part${i + 1}`);
      outputFiles.push(path.basename(outPath));
    }

    if (outputFiles.length === 1) {
      return res.json({ success: true, file: outputFiles[0], url: `/api/files/${outputFiles[0]}` });
    }

    // Zip multiple files
    const zipName = `split-${uuidv4()}.zip`;
    const zipPath = path.join(OUTPUT_DIR, zipName);
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip');
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      outputFiles.forEach(f => archive.file(path.join(OUTPUT_DIR, f), { name: f }));
      archive.finalize();
    });

    res.json({ success: true, file: zipName, url: `/api/files/${zipName}` });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/remove-pages ─────────────────────────────────────────
// Body: file, pages: JSON array of 1-indexed page numbers to remove
router.post('/remove-pages', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.body.pages) return res.status(400).json({ error: 'Provide pages array.' });

    const toRemove = new Set(JSON.parse(req.body.pages).map(n => n - 1)); // to 0-indexed
    const srcDoc = await loadPdf(req.file.path);
    const total = srcDoc.getPageCount();
    const keepIndices = [];
    for (let i = 0; i < total; i++) { if (!toRemove.has(i)) keepIndices.push(i); }

    if (keepIndices.length === 0)
      return res.status(400).json({ error: 'Cannot remove all pages.' });

    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(srcDoc, keepIndices);
    pages.forEach(p => newDoc.addPage(p));

    const outPath = await savePdf(newDoc, 'removed-pages');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/extract-pages ────────────────────────────────────────
// Body: file, pages: JSON array of 1-indexed page numbers to extract
router.post('/extract-pages', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.body.pages) return res.status(400).json({ error: 'Provide pages array.' });

    const indices = JSON.parse(req.body.pages).map(n => n - 1);
    const srcDoc = await loadPdf(req.file.path);
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(srcDoc, indices);
    pages.forEach(p => newDoc.addPage(p));

    const outPath = await savePdf(newDoc, 'extracted');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/rotate ────────────────────────────────────────────────
// Body: file, angle: 90 | 180 | 270, pages: JSON array (optional, default all)
router.post('/rotate', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const angle = parseInt(req.body.angle) || 90;
    const srcDoc = await loadPdf(req.file.path);
    const total = srcDoc.getPageCount();
    const targetPages = req.body.pages
      ? JSON.parse(req.body.pages).map(n => n - 1)
      : Array.from({ length: total }, (_, i) => i);

    const newDoc = await PDFDocument.create();
    const allPages = await newDoc.copyPages(srcDoc, srcDoc.getPageIndices());
    allPages.forEach((page, i) => {
      if (targetPages.includes(i)) {
        page.setRotation(degrees((page.getRotation().angle + angle) % 360));
      }
      newDoc.addPage(page);
    });

    const outPath = await savePdf(newDoc, 'rotated');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/reorder ───────────────────────────────────────────────
// Body: file, order: JSON array of 0-indexed page positions
router.post('/reorder', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.body.order) return res.status(400).json({ error: 'Provide order array.' });

    const order = JSON.parse(req.body.order);
    const srcDoc = await loadPdf(req.file.path);
    const newDoc = await PDFDocument.create();
    const pages = await newDoc.copyPages(srcDoc, order);
    pages.forEach(p => newDoc.addPage(p));

    const outPath = await savePdf(newDoc, 'reordered');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

module.exports = router;
