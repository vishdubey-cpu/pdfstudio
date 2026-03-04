const express = require('express');
const router = express.Router();
const { PDFDocument, rgb } = require('pdf-lib');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf, OUTPUT_DIR, formatBytes } = require('../services/pdfUtils');

const execFileAsync = promisify(execFile);

// ─── POST /api/security/protect ───────────────────────────────────────────────
router.post('/protect', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.body.userPassword) return res.status(400).json({ error: 'Password is required.' });

    const userPw = req.body.userPassword;
    const ownerPw = req.body.ownerPassword || userPw;
    const outFilename = `protected-${uuidv4()}.pdf`;
    const outPath = path.join(OUTPUT_DIR, outFilename);

    await execFileAsync('qpdf', [
      '--encrypt', userPw, ownerPw, '256', '--',
      req.file.path, outPath,
    ]);

    const outSize = (await fs.stat(outPath)).size;
    res.json({
      success: true,
      file: outFilename,
      url: `/api/files/${outFilename}`,
      stats: [
        { label: 'Status',     value: 'Password protected ✓' },
        { label: 'Encryption', value: 'AES-256' },
        { label: 'File size',  value: formatBytes(outSize) },
      ],
    });
  } catch (e) { next(e); }
});

// ─── POST /api/security/unlock ────────────────────────────────────────────────
// Body: file, password
router.post('/unlock', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    if (!req.body.password) return res.status(400).json({ error: 'Password is required.' });
    const password = req.body.password;
    const bytes = await fs.readFile(req.file.path);

    let pdfDoc;
    try {
      pdfDoc = await PDFDocument.load(bytes, {
        password,
        ignoreEncryption: false,
      });
    } catch (e) {
      return res.status(400).json({ error: 'Incorrect password or could not unlock PDF.' });
    }

    // Re-save without password
    const outPath = await savePdf(pdfDoc, 'unlocked');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/security/sign ──────────────────────────────────────────────────
// Body: file, signatureImage (base64 PNG/JPEG), x, y, page, width, height
router.post('/sign', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.body.signatureImage) return res.status(400).json({ error: 'signatureImage (base64) is required.' });

    const pdfDoc = await loadPdf(req.file.path);
    const pages = pdfDoc.getPages();
    const pageNum = parseInt(req.body.page || 1) - 1;
    const page = pages[pageNum];
    if (!page) return res.status(400).json({ error: 'Invalid page number.' });

    // Decode base64 image
    const b64 = req.body.signatureImage.replace(/^data:image\/\w+;base64,/, '');
    const imgBytes = Buffer.from(b64, 'base64');

    let img;
    try {
      img = await pdfDoc.embedPng(imgBytes);
    } catch {
      img = await pdfDoc.embedJpg(imgBytes);
    }

    const sigWidth = parseFloat(req.body.width) || 150;
    const sigHeight = parseFloat(req.body.height) || 60;
    const x = parseFloat(req.body.x) || 50;
    const y = parseFloat(req.body.y) || 50;

    page.drawImage(img, { x, y, width: sigWidth, height: sigHeight });

    const outPath = await savePdf(pdfDoc, 'signed');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/security/redact ────────────────────────────────────────────────
// Body: file, regions: JSON array of {x, y, width, height, page}
router.post('/redact', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.body.regions) return res.status(400).json({ error: 'regions array is required.' });

    let regions;
    try { regions = JSON.parse(req.body.regions); } catch {
      return res.status(400).json({ error: 'Invalid regions format. Provide a JSON array.' });
    }
    const pdfDoc = await loadPdf(req.file.path);
    const pages = pdfDoc.getPages();

    for (const region of regions) {
      const page = pages[(region.page || 1) - 1];
      if (!page) continue;
      page.drawRectangle({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        color: rgb(0, 0, 0),
        opacity: 1,
      });
    }

    const outPath = await savePdf(pdfDoc, 'redacted');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

module.exports = router;
