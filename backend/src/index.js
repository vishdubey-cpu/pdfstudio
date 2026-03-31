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

  const minPdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n' +
    'xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n' +
    '0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF'
  );

  // Test 1: /tmp → /tmp (known working)
  const t1in = '/tmp/gs-t1-in.pdf'; const t1out = '/tmp/gs-t1-out.pdf';
  await fsLocal.writeFile(t1in, minPdf);
  try {
    await execFileAsync('gs', ['-sDEVICE=pdfwrite','-dNOPAUSE','-dBATCH','-dPDFSETTINGS=/screen',`-sOutputFile=${t1out}`,t1in], { timeout: 30000 });
    results.test_tmp_to_tmp = 'SUCCESS';
  } catch (e) { results.test_tmp_to_tmp = `FAIL: ${e.stderr||e.message}`; }

  // Test 2: /tmp → /app/outputs/
  const t2out = '/app/outputs/gs-diag-out.pdf';
  try {
    await execFileAsync('gs', ['-sDEVICE=pdfwrite','-dNOPAUSE','-dBATCH','-dPDFSETTINGS=/screen',`-sOutputFile=${t2out}`,t1in], { timeout: 30000 });
    results.test_tmp_to_outputs = 'SUCCESS';
  } catch (e) { results.test_tmp_to_outputs = `FAIL: ${e.stderr||e.message}`; }

  // Test 3: /app/uploads/testdir/ → /tmp
  const t3dir = '/app/uploads/gs-diag-test'; const t3in = `${t3dir}/test.pdf`; const t3out = '/tmp/gs-t3-out.pdf';
  await fsLocal.ensureDir(t3dir); await fsLocal.writeFile(t3in, minPdf);
  try {
    await execFileAsync('gs', ['-sDEVICE=pdfwrite','-dNOPAUSE','-dBATCH','-dPDFSETTINGS=/screen',`-sOutputFile=${t3out}`,t3in], { timeout: 30000 });
    results.test_uploads_subdir_to_tmp = 'SUCCESS';
  } catch (e) { results.test_uploads_subdir_to_tmp = `FAIL: ${e.stderr||e.message}`; }

  // Test 4: /app/uploads/testdir/ → /app/outputs/
  const t4out = '/app/outputs/gs-diag-t4-out.pdf';
  try {
    await execFileAsync('gs', ['-sDEVICE=pdfwrite','-dNOPAUSE','-dBATCH','-dPDFSETTINGS=/screen',`-sOutputFile=${t4out}`,t3in], { timeout: 30000 });
    results.test_uploads_subdir_to_outputs = 'SUCCESS';
  } catch (e) { results.test_uploads_subdir_to_outputs = `FAIL: ${e.stderr||e.message}`; }

  // Test 5: download real PDF (africau sample) and try both old+new interpreter
  const https = require('https');
  const realPdfPath = '/tmp/gs-real-test.pdf';
  const realOutOld  = '/tmp/gs-real-old.pdf';
  const realOutNew  = '/tmp/gs-real-new.pdf';
  await new Promise((resolve) => {
    const f = fsLocal.createWriteStream(realPdfPath);
    https.get('https://www.africau.edu/images/default/sample.pdf', r => { r.pipe(f); f.on('finish', resolve); }).on('error', resolve);
  });
  // Old interpreter (-dNEWPDF=false)
  try {
    await execFileAsync('gs', ['-sDEVICE=pdfwrite','-dNOPAUSE','-dBATCH','-dNEWPDF=false','-dPDFSETTINGS=/screen',`-sOutputFile=${realOutOld}`,realPdfPath], { timeout: 60000 });
    const sz = (await fsLocal.stat(realOutOld)).size;
    results.test_real_pdf_old_interp = `SUCCESS — ${sz} bytes`;
  } catch (e) { results.test_real_pdf_old_interp = `FAIL: ${(e.stderr||'').substring(0,300)}`; }
  // New interpreter (default in GS 10)
  try {
    await execFileAsync('gs', ['-sDEVICE=pdfwrite','-dNOPAUSE','-dBATCH','-dNEWPDF=true','-dPDFSETTINGS=/screen',`-sOutputFile=${realOutNew}`,realPdfPath], { timeout: 60000 });
    const sz = (await fsLocal.stat(realOutNew)).size;
    results.test_real_pdf_new_interp = `SUCCESS — ${sz} bytes`;
  } catch (e) { results.test_real_pdf_new_interp = `FAIL: ${(e.stderr||'').substring(0,300)}`; }

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
