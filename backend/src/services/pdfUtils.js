const { PDFDocument, degrees, rgb, StandardFonts, PDFName } = require('pdf-lib');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const OUTPUT_DIR = path.join(__dirname, '../../outputs');
fs.ensureDirSync(OUTPUT_DIR);

/**
 * Load a PDF from disk into pdf-lib PDFDocument
 */
async function loadPdf(filePath) {
  const bytes = await fs.readFile(filePath);
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

/**
 * Save a PDFDocument to the outputs folder and return the output path
 */
async function savePdf(pdfDoc, prefix = 'output') {
  const bytes = await pdfDoc.save();
  const outName = `${prefix}-${uuidv4()}.pdf`;
  const outPath = path.join(OUTPUT_DIR, outName);
  await fs.writeFile(outPath, bytes);
  return outPath;
}

/**
 * Save arbitrary buffer to outputs folder
 */
async function saveBuffer(buffer, ext = 'bin', prefix = 'output') {
  const outName = `${prefix}-${uuidv4()}.${ext}`;
  const outPath = path.join(OUTPUT_DIR, outName);
  await fs.writeFile(outPath, buffer);
  return outPath;
}

module.exports = { loadPdf, savePdf, saveBuffer, OUTPUT_DIR };
