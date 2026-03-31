require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs-extra');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure upload/output dirs exist
fs.ensureDirSync(path.join(__dirname, '../uploads'));
fs.ensureDirSync(path.join(__dirname, '../outputs'));

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan('dev'));
app.use(express.json());

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Status-polling endpoints (GET .../status/:jobId) are hit every 3 s per job.
// A single compression job can generate 30–60 poll requests if processing is
// slow. Keep a generous limit so legitimate users are never blocked.

// Upload / tool-action endpoints (POST) — 30 per 15 min per IP
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
  skip: (req) => req.method !== 'POST',
});

// Status-poll endpoints (GET) — 600 per 15 min per IP (plenty for async polling)
const pollLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
  skip: (req) => req.method !== 'GET',
});

app.use('/api/', uploadLimiter);
app.use('/api/', pollLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/organize',  require('./routes/organize'));
app.use('/api/optimize',  require('./routes/optimize'));
app.use('/api/convert',   require('./routes/convert'));
app.use('/api/edit',      require('./routes/edit'));
app.use('/api/security',  require('./routes/security'));
app.use('/api/files',     require('./routes/files'));

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── GS Diagnostic (temp) ────────────────────────────────────────────────────
app.get('/diagnose-gs', async (req, res) => {
  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const fsLocal = require('fs-extra');
  const execFileAsync = promisify(execFile);
  const results = {};

  try {
    const v = await execFileAsync('gs', ['--version'], { timeout: 10000 });
    results.gsVersion = v.stdout.trim();
  } catch (e) { results.gsVersion = `FAIL: ${e.message}`; }

  // Check if pdfwrite device is available
  try {
    const devCheck = await execFileAsync('gs', ['-dBATCH', '-dNOPAUSE', '-dNODISPLAY', '-q',
      '-c', 'devicenames { (pdfwrite) eq { (FOUND pdfwrite) = } if } forall quit'], { timeout: 15000 });
    results.pdfwriteDevice = devCheck.stdout.trim() || 'not found in output';
  } catch (e) { results.pdfwriteDevice = `FAIL: ${e.message}`; }

  // Write a minimal valid PDF and try to compress it
  const minPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n' +
    '0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF'
  );
  const inPath  = '/tmp/gs-diag-in.pdf';
  const outPath = '/tmp/gs-diag-out.pdf';
  try {
    await fsLocal.writeFile(inPath, minPdf);
    const gsResult = await execFileAsync('gs', [
      '-sDEVICE=pdfwrite', '-dNOPAUSE', '-dBATCH', '-dPDFSETTINGS=/screen',
      `-sOutputFile=${outPath}`, inPath,
    ], { timeout: 30000 });
    const outStat = await fsLocal.stat(outPath);
    results.pdfwriteTest = `SUCCESS — output ${outStat.size} bytes`;
    results.gsStdout = gsResult.stdout.substring(0, 500);
  } catch (e) {
    results.pdfwriteTest = `FAIL: ${e.message}`;
    results.gsStderr = (e.stderr || '').substring(0, 800);
    results.gsStdout = (e.stdout || '').substring(0, 800);
  }

  res.json(results);
});

// ─── Cleanup job: delete files older than 2 hours ────────────────────────────
async function cleanOldFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      const fp = path.join(dir, entry.name);
      const stat = await fs.stat(fp);
      if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) {
        await fs.remove(fp);
      }
    }
  } catch (e) {
    console.error('[cleanup] Error reading dir:', e.message);
  }
}

schedule.scheduleJob('*/30 * * * *', async () => {
  try {
    await cleanOldFiles(path.join(__dirname, '../uploads'));
    await cleanOldFiles(path.join(__dirname, '../outputs'));
    console.log('[cleanup] Old files removed');
  } catch (e) {
    console.error('[cleanup] Error:', e.message);
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => console.log(`✅  PDF Studio API running on port ${PORT}`));
