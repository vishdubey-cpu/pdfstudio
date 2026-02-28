const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs-extra');
const mime = require('mime-types');
const { OUTPUT_DIR } = require('../services/pdfUtils');

// GET /api/files/:filename — download a processed file
router.get('/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;

    // Security: strip path traversal
    const safe = path.basename(filename);
    const filePath = path.join(OUTPUT_DIR, safe);

    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: 'File not found or has expired.' });
    }

    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    res.setHeader('Cache-Control', 'no-store');

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', next);
  } catch (e) { next(e); }
});

// GET /api/files/:filename/info — get file metadata without downloading
router.get('/:filename/info', async (req, res, next) => {
  try {
    const safe = path.basename(req.params.filename);
    const filePath = path.join(OUTPUT_DIR, safe);

    if (!(await fs.pathExists(filePath))) {
      return res.status(404).json({ error: 'File not found or has expired.' });
    }

    const stat = await fs.stat(filePath);
    res.json({
      filename: safe,
      size: stat.size,
      created: stat.birthtime,
      expires: new Date(stat.mtimeMs + 2 * 60 * 60 * 1000),
      mimeType: mime.lookup(filePath) || 'application/octet-stream',
    });
  } catch (e) { next(e); }
});

module.exports = router;
