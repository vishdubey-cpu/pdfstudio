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

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 60,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/organize',  require('./routes/organize'));
app.use('/api/optimize',  require('./routes/optimize'));
app.use('/api/convert',   require('./routes/convert'));
app.use('/api/edit',      require('./routes/edit'));
app.use('/api/security',  require('./routes/security'));
app.use('/api/files',     require('./routes/files'));

// Health check
app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Cleanup job: delete files older than 2 hours ────────────────────────────
async function cleanOldFiles(dir) {
  const files = await fs.readdir(dir);
  const now = Date.now();
  for (const file of files) {
    const fp = path.join(dir, file);
    const stat = await fs.stat(fp);
    if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) {
      await fs.remove(fp);
    }
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
