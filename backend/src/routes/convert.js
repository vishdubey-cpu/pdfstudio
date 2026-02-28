const express = require('express');
const router = express.Router();
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { execSync, spawn } = require('child_process');
const archiver = require('archiver');
const { upload, withJobId } = require('../middleware/upload');
const { loadPdf, savePdf, saveBuffer, OUTPUT_DIR } = require('../services/pdfUtils');

// Helper: check if LibreOffice is available
function libreOfficeAvailable() {
  try {
    execSync('libreoffice --version', { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execSync('soffice --version', { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }
}

// Helper: convert via LibreOffice
async function convertWithLibreOffice(inputPath, outputDir, format = 'pdf') {
  return new Promise((resolve, reject) => {
    const cmd = libreOfficeAvailable() ? 'libreoffice' : 'soffice';
    const proc = spawn(cmd, [
      '--headless',
      '--convert-to', format,
      '--outdir', outputDir,
      inputPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) {
        const base = path.basename(inputPath, path.extname(inputPath));
        const outFile = path.join(outputDir, `${base}.${format}`);
        resolve(outFile);
      } else {
        reject(new Error(`LibreOffice failed (code ${code}): ${stderr}`));
      }
    });
    proc.on('error', reject);
  });
}

// ─── POST /api/convert/jpg-to-pdf ─────────────────────────────────────────────
router.post('/jpg-to-pdf', withJobId, upload.array('files', 30), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: 'No images uploaded.' });

    const pdfDoc = await PDFDocument.create();
    const orientation = req.body.orientation || 'auto'; // portrait | landscape | auto
    const margin = parseFloat(req.body.margin) || 0;

    for (const file of req.files) {
      // Normalise image to JPEG via sharp
      const jpegBuf = await sharp(file.path).jpeg({ quality: 90 }).toBuffer();
      const img = await pdfDoc.embedJpg(jpegBuf);
      const { width: imgW, height: imgH } = img.scale(1);

      let pageW = imgW + margin * 2;
      let pageH = imgH + margin * 2;

      if (orientation === 'portrait' && pageW > pageH) [pageW, pageH] = [pageH, pageW];
      if (orientation === 'landscape' && pageH > pageW) [pageW, pageH] = [pageH, pageW];

      const page = pdfDoc.addPage([pageW, pageH]);
      page.drawImage(img, { x: margin, y: margin, width: imgW, height: imgH });
    }

    const outPath = await savePdf(pdfDoc, 'images-to-pdf');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/convert/pdf-to-jpg ─────────────────────────────────────────────
router.post('/pdf-to-jpg', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const { fromPath } = require('pdf2pic');
    const dpi = parseInt(req.body.dpi) || 150;
    const pdfDoc = await loadPdf(req.file.path);
    const totalPages = pdfDoc.getPageCount();
    const maxPages = Math.min(totalPages, 20);

    const converter = fromPath(req.file.path, {
      density: dpi,
      saveFilename: uuidv4(),
      savePath: OUTPUT_DIR,
      format: 'jpg',
    });

    const urls = [];
    for (let i = 1; i <= maxPages; i++) {
      const result = await converter(i, { responseType: 'image' });
      urls.push({ page: i, file: path.basename(result.path), url: `/api/files/${path.basename(result.path)}` });
    }

    if (urls.length === 1) {
      return res.json({ success: true, ...urls[0] });
    }

    // Zip all images
    const zipName = `pdf-to-jpg-${uuidv4()}.zip`;
    const zipPath = path.join(OUTPUT_DIR, zipName);
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip');
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      urls.forEach(u => archive.file(path.join(OUTPUT_DIR, u.file), { name: u.file }));
      archive.finalize();
    });

    res.json({ success: true, pages: urls, zip: zipName, url: `/api/files/${zipName}` });
  } catch (e) { next(e); }
});

// ─── POST /api/convert/office-to-pdf ──────────────────────────────────────────
// Handles Word, Excel, PowerPoint → PDF via LibreOffice
router.post('/office-to-pdf', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    if (!libreOfficeAvailable()) {
      return res.status(501).json({
        error: 'LibreOffice is not installed on this server.',
        hint: 'Add "RUN apt-get install -y libreoffice" to your Railway Dockerfile.',
      });
    }

    const outFile = await convertWithLibreOffice(req.file.path, OUTPUT_DIR, 'pdf');
    res.json({ success: true, file: path.basename(outFile), url: `/api/files/${path.basename(outFile)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/convert/pdf-to-office ──────────────────────────────────────────
// PDF → Word/Excel/PowerPoint via LibreOffice (limited fidelity)
router.post('/pdf-to-office', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const format = req.body.format || 'docx'; // docx | xlsx | pptx

    if (!libreOfficeAvailable()) {
      return res.status(501).json({
        error: 'LibreOffice is not installed on this server.',
        hint: 'Add "RUN apt-get install -y libreoffice" to your Railway Dockerfile.',
      });
    }

    const outFile = await convertWithLibreOffice(req.file.path, OUTPUT_DIR, format);
    res.json({ success: true, file: path.basename(outFile), url: `/api/files/${path.basename(outFile)}` });
  } catch (e) { next(e); }
});

// ─── POST /api/convert/pdf-to-pdfa ────────────────────────────────────────────
// Simplified: re-save with pdf-lib (full PDF/A requires ghostscript in prod)
router.post('/pdf-to-pdfa', withJobId, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const pdfDoc = await loadPdf(req.file.path);
    // Set PDF/A metadata marker (full conformance requires Ghostscript in prod)
    pdfDoc.setTitle(pdfDoc.getTitle() || 'PDF/A Document');
    pdfDoc.setProducer('PDF Studio');
    pdfDoc.setCreator('PDF Studio');

    const outPath = await savePdf(pdfDoc, 'pdfa');
    res.json({ success: true, file: path.basename(outPath), url: `/api/files/${path.basename(outPath)}` });
  } catch (e) { next(e); }
});

module.exports = router;
