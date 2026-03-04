const express = require('express');
const router = express.Router();
const { PDFDocument } = require('pdf-lib');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf, OUTPUT_DIR, formatBytes } = require('../services/pdfUtils');

// ─── POST /api/organize/merge ─────────────────────────────────────────────────
router.post('/merge', withJobId, upload.array('files', 20), async (req, res, next) => {
  try {
    if (!req.files || req.files.length < 2)
      return res.status(400).json({ error: 'Please upload at least 2 PDF files.' });

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
    const outSize = (await fs.stat(outPath)).size;

    res.json({
      success: true,
      file: path.basename(outPath),
      url: `/api/files/${path.basename(outPath)}`,
      stats: [
        { label: 'Files merged', value: String(req.files.length) },
        { label: 'Total pages', value: String(merged.getPageCount()) },
        { label: 'Output size', value: formatBytes(outSize) },
      ],
    });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/split ─────────────────────────────────────────────────
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
      const outSize = (await fs.stat(path.join(OUTPUT_DIR, outputFiles[0]))).size;
      return res.json({
        success: true,
        file: outputFiles[0],
        url: `/api/files/${outputFiles[0]}`,
        stats: [
          { label: 'Original pages', value: String(totalPages) },
          { label: 'Parts created', value: '1' },
          { label: 'Output size', value: formatBytes(outSize) },
        ],
      });
    }

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

    const zipSize = (await fs.stat(zipPath)).size;
    res.json({
      success: true,
      file: zipName,
      url: `/api/files/${zipName}`,
      stats: [
        { label: 'Original pages', value: String(totalPages) },
        { label: 'Parts created', value: String(outputFiles.length) },
        { label: 'ZIP size', value: formatBytes(zipSize) },
      ],
    });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/remove-pages ─────────────────────────────────────────
router.post('/remove-pages', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.body.pages) return res.status(400).json({ error: 'Provide pages array.' });

    const toRemove = new Set(JSON.parse(req.body.pages).map(n => n - 1));
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
    const outSize = (await fs.stat(outPath)).size;

    res.json({
      success: true,
      file: path.basename(outPath),
      url: `/api/files/${path.basename(outPath)}`,
      stats: [
        { label: 'Original pages', value: String(total) },
        { label: 'Pages removed', value: String(toRemove.size) },
        { label: 'Remaining pages', value: String(keepIndices.length) },
        { label: 'Output size', value: formatBytes(outSize) },
      ],
    });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/extract-pages ────────────────────────────────────────
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
    const outSize = (await fs.stat(outPath)).size;

    res.json({
      success: true,
      file: path.basename(outPath),
      url: `/api/files/${path.basename(outPath)}`,
      stats: [
        { label: 'Source pages', value: String(srcDoc.getPageCount()) },
        { label: 'Pages extracted', value: String(indices.length) },
        { label: 'Output size', value: formatBytes(outSize) },
      ],
    });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/rotate ────────────────────────────────────────────────
const { degrees } = require('pdf-lib');
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
    const outSize = (await fs.stat(outPath)).size;

    res.json({
      success: true,
      file: path.basename(outPath),
      url: `/api/files/${path.basename(outPath)}`,
      stats: [
        { label: 'Total pages', value: String(total) },
        { label: 'Pages rotated', value: String(targetPages.length) },
        { label: 'Rotation', value: `${angle}°` },
        { label: 'Output size', value: formatBytes(outSize) },
      ],
    });
  } catch (e) { next(e); }
});

// ─── POST /api/organize/reorder ───────────────────────────────────────────────
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
    const outSize = (await fs.stat(outPath)).size;

    res.json({
      success: true,
      file: path.basename(outPath),
      url: `/api/files/${path.basename(outPath)}`,
      stats: [
        { label: 'Pages reordered', value: String(order.length) },
        { label: 'Output size', value: formatBytes(outSize) },
      ],
    });
  } catch (e) { next(e); }
});

module.exports = router;
