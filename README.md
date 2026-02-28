# PDF Studio

A full-stack PDF tools web app — 25+ tools, elegant UX, built for real production deployment.

**Architecture:**
- `frontend/` → React + Vite + Tailwind → deploy to **Vercel** (free)
- `backend/` → Node.js + Express → deploy to **Railway** (~$5/mo)

---

## 🚀 Deploy in 20 minutes

### Step 1 — Deploy the Backend to Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select this repo and set the **Root Directory** to `backend`
4. Railway auto-detects the `Dockerfile` — it will install LibreOffice, Tesseract, and all dependencies
5. In **Settings → Variables**, add:
   ```
   NODE_ENV=production
   FRONTEND_URL=https://your-vercel-url.vercel.app
   ```
6. Once deployed, copy your Railway URL — it will look like:
   `https://pdfstudio-backend-production.up.railway.app`

---

### Step 2 — Deploy the Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **New Project → Import** this repo
3. Set the **Root Directory** to `frontend`
4. In **Environment Variables**, add:
   ```
   VITE_API_URL=https://your-railway-url.up.railway.app/api
   ```
5. Vercel auto-detects Vite — click **Deploy**
6. Once deployed, copy your Vercel URL and paste it into your Railway `FRONTEND_URL` variable

---

## 🛠 Local Development

### Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev        # starts on http://localhost:3001
```

### Frontend
```bash
cd frontend
cp .env.example .env
# Set VITE_API_URL=http://localhost:3001/api (or leave blank — vite proxy handles it)
npm install
npm run dev        # starts on http://localhost:5173
```

> The Vite dev server proxies `/api` → `localhost:3001` automatically via `vite.config.js`.

---

## 📦 What's included

### API Endpoints (all `POST`, all `multipart/form-data`)

| Method | Endpoint | Tool |
|--------|----------|------|
| POST | `/api/organize/merge` | Merge PDFs |
| POST | `/api/organize/split` | Split PDF |
| POST | `/api/organize/remove-pages` | Remove pages |
| POST | `/api/organize/extract-pages` | Extract pages |
| POST | `/api/organize/rotate` | Rotate PDF |
| POST | `/api/organize/reorder` | Reorder pages |
| POST | `/api/optimize/compress` | Compress PDF |
| POST | `/api/optimize/repair` | Repair PDF |
| POST | `/api/optimize/ocr` | OCR PDF |
| POST | `/api/convert/jpg-to-pdf` | JPG → PDF |
| POST | `/api/convert/pdf-to-jpg` | PDF → JPG |
| POST | `/api/convert/office-to-pdf` | Word/Excel/PPT → PDF |
| POST | `/api/convert/pdf-to-office` | PDF → Word/Excel/PPT |
| POST | `/api/convert/pdf-to-pdfa` | PDF → PDF/A |
| POST | `/api/edit/watermark` | Add watermark |
| POST | `/api/edit/page-numbers` | Add page numbers |
| POST | `/api/edit/crop` | Crop PDF |
| POST | `/api/edit/add-text` | Add text overlay |
| POST | `/api/security/unlock` | Unlock PDF |
| POST | `/api/security/protect` | Password-protect PDF |
| POST | `/api/security/sign` | Sign PDF |
| POST | `/api/security/redact` | Redact content |
| GET  | `/api/files/:filename` | Download output |
| GET  | `/health` | Health check |

### File Cleanup
Files are automatically deleted every 30 minutes if older than 2 hours. No manual cleanup required.

---

## 🔧 Production Notes

### LibreOffice (Word/Excel/PPT conversion)
Already included in the Dockerfile. Railway will build it automatically. First build takes ~5 minutes due to LibreOffice size.

### PDF Encryption (Protect PDF)
Requires `qpdf` — already in the Dockerfile (`apt-get install qpdf`). Wire up `node-qpdf2` package to the `/api/security/protect` route for full AES-256 encryption.

### Scaling
- Add a Redis job queue (Bull/BullMQ) if you expect high traffic
- Add S3/R2 storage instead of local filesystem for multi-instance deployments
- Set `RAILWAY_VOLUME_MOUNT_PATH` for persistent storage on Railway

### Rate Limiting
Currently set to 60 requests per 15 minutes per IP. Adjust in `src/index.js`.

---

## 🏗 Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite, Tailwind CSS, Framer Motion |
| Backend | Node.js, Express |
| PDF processing | pdf-lib (merge/split/edit), pdf2pic, sharp |
| OCR | Tesseract.js (no system dependency) |
| Office conversion | LibreOffice headless |
| Image processing | sharp (Node binding to libvips) |
| File compression | archiver (ZIP) |
| Deploy (frontend) | Vercel |
| Deploy (backend) | Railway (Docker) |
