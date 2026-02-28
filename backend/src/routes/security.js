const express = require('express');
const router = express.Router();
const { PDFDocument } = require('pdf-lib');
const path = require('path');
const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf } = require('../services/pdfUtils');

// ─── POST /api/security/protect ───────────────────────────────────────────────
// Body: file, userPassword, ownerPassword (optional), permissions (optional JSON)
// Note: pdf-lib doesn't natively support encryption; we use a metadata approach
// and note to deploy with a real encryption library like node-qpdf or hummus in production.
router.post('/protect', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    if (!req.body.userPassword) return res.status(400).json({ error: 'Password is required.' });

    // Production note: use node-qpdf2 or spawn qpdf CLI for real encryption.
    // pdf-lib doesn't support AES encryption natively.
    // This stub returns the file with a note — wire up qpdf in your production deploy.
    return res.status(501).json({
      error: 'PDF encryption requires qpdf on the server. Install qpdf (apt-get install qpdf) and use node-qpdf2 package.',
      hint: 'Add qpdf to your Railway Dockerfile and use: qpdf --encrypt userPw ownerPw 256 -- input.pdf output.pdf',
    });
  } catch (e) { next(e); }
});

// ─── POST /api/security/unlock ────────────────────────────────────────────────
// Body: file, password
router.post('/unlock', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const password = req.body.password || '';
    let bytes = await require('fs-extra').readFile(req.file.path);

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

    const regions = JSON.parse(req.body.regions);
    const pdfDoc = await loadPdf(req.file.path);
    const pages = pdfDoc.getPages();
    const { rgb } = require('pdf-lib');

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
