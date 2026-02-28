# PDF Studio — Project Briefing

## Overview

**PDF Studio** is a PDF tools web app that lets users merge, split, compress, convert, edit, and secure PDF files — all free, no signup, no watermarks. The app is ad-monetized via Google AdSense.

---

## Stack

| Layer     | Tech                              | Port |
|-----------|-----------------------------------|------|
| Frontend  | React + Vite + Tailwind CSS       | 5173 |
| Backend   | Node.js + Express                 | 3001 |

---

## Project Structure

```
pdfstudio/
├── CLAUDE.md
├── README.md
├── frontend/                  # React + Vite app
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── vercel.json            # ← to be replaced with netlify.toml
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css
│       ├── components/
│       │   ├── AdSlot.jsx     # Google AdSense ad units
│       │   ├── Navbar.jsx
│       │   ├── ToolCard.jsx
│       │   └── ToolModal.jsx
│       ├── pages/
│       │   ├── Home.jsx       # Grid of all tools
│       │   └── ToolPage.jsx   # Individual tool page at /tools/:toolId
│       └── utils/
│           ├── api.js         # Axios client; VITE_API_URL env var sets base URL
│           ├── seo.js         # Per-tool SEO metadata (title, description, H1, FAQs)
│           └── tools.js       # Single source of truth: all tool definitions
└── backend/
    ├── package.json
    ├── Dockerfile
    ├── uploads/               # Temp uploaded files (auto-cleaned every 30 min)
    ├── outputs/               # Processed output files (auto-cleaned every 30 min)
    └── src/
        ├── index.js           # Express entry point
        ├── routes/
        │   ├── organize.js    # /api/organize  — merge, split, reorder, rotate
        │   ├── optimize.js    # /api/optimize  — compress
        │   ├── convert.js     # /api/convert   — pdf-to-word, pdf-to-image, image-to-pdf, etc.
        │   ├── edit.js        # /api/edit      — watermark, page-numbers, crop
        │   ├── security.js    # /api/security  — protect (encrypt), unlock (decrypt)
        │   └── files.js       # /api/files     — download output files
        ├── middleware/
        └── services/
```

---

## Key Files

### `frontend/src/utils/tools.js`
Single source of truth for every tool. Each entry defines:
- `id` — used as the URL slug (`/tools/:toolId`) and to look up SEO metadata
- `category` — maps to a backend route group (`organize`, `optimize`, `convert`, `edit`, `security`)
- `endpoint` — the backend API path the form posts to
- `fields` — declarative form field config rendered by `ToolPage`
- `multiFile` — whether multiple files can be uploaded

### `frontend/src/utils/seo.js`
Exports `TOOL_SEO` — a map of `toolId → { title, description, h1, intro, keywords, faqs }`. Used by `ToolPage.jsx` to set `<title>`, meta tags, and render SEO-friendly content below the tool UI.

### `frontend/src/components/AdSlot.jsx`
Renders Google AdSense `<ins>` ad units. AdSense publisher ID and slot IDs live here. Update this file to change ad placements or swap slot IDs.

### `frontend/src/utils/api.js`
Axios instance. Base URL is controlled by the `VITE_API_URL` environment variable (set to the deployed Railway backend URL in production). Falls back to `/api` for local dev (proxied by Vite).

### `backend/src/index.js`
Express entry point. Key config:
- Rate limiting: 60 requests / 15 min per IP
- CORS origin controlled by `FRONTEND_URL` env var
- Files older than 2 hours are purged from `uploads/` and `outputs/` every 30 minutes via `node-schedule`

---

## Environment Variables

### Frontend (`.env` / Netlify dashboard)
| Variable       | Value (prod)                        |
|----------------|-------------------------------------|
| `VITE_API_URL` | `https://<your-railway-app>.up.railway.app/api` |

### Backend (`.env` / Railway dashboard)
| Variable        | Value (prod)           |
|-----------------|------------------------|
| `PORT`          | Set automatically by Railway |
| `FRONTEND_URL`  | `https://<your-netlify-app>.netlify.app` |

---

## Local Development

```bash
# Terminal 1 — backend
cd backend && npm install && npm run dev   # http://localhost:3001

# Terminal 2 — frontend
cd frontend && npm install && npm run dev  # http://localhost:5173
```

Vite proxies `/api` → `localhost:3001` (see `vite.config.js`).

---

## Routing

Frontend uses React Router with client-side routing:
- `/` — Home page (tool grid)
- `/tools/:toolId` — Individual tool page (e.g. `/tools/merge`, `/tools/compress`)

The SPA needs a catch-all redirect on the host so deep links don't 404.

---

## Next Steps (in order)

### 1. Replace `vercel.json` with `netlify.toml`

Delete `frontend/vercel.json` and create `frontend/netlify.toml`:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

This replaces the Vercel SPA routing config with the Netlify equivalent.

### 2. Initialize Git and push to GitHub

```bash
cd /path/to/pdfstudio
git init
git add .
git commit -m "Initial commit"
# Create a repo on github.com, then:
git remote add origin https://github.com/<you>/pdfstudio.git
git push -u origin main
```

### 3. Deploy frontend to Netlify

1. Connect the GitHub repo to Netlify
2. Set **Base directory**: `frontend`
3. Set **Build command**: `npm run build`
4. Set **Publish directory**: `frontend/dist`
5. Add environment variable: `VITE_API_URL=https://<railway-url>/api`
6. Netlify auto-deploys on every push to `main`

### 4. Deploy backend to Railway

1. Create a new Railway project → link GitHub repo
2. Set **Root directory**: `backend`
3. Railway detects `package.json` and runs `npm start`
4. Add environment variable: `FRONTEND_URL=https://<netlify-url>`
5. Railway provides a public HTTPS URL — paste it into Netlify's `VITE_API_URL`

---

## Backend API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/organize/merge` | Merge multiple PDFs |
| POST | `/api/organize/split` | Split PDF by page range |
| POST | `/api/organize/reorder` | Reorder pages |
| POST | `/api/organize/rotate` | Rotate pages |
| POST | `/api/optimize/compress` | Compress / reduce file size |
| POST | `/api/convert/pdf-to-word` | PDF → DOCX |
| POST | `/api/convert/pdf-to-image` | PDF → PNG/JPG per page |
| POST | `/api/convert/image-to-pdf` | Image(s) → PDF |
| POST | `/api/edit/watermark` | Add text watermark |
| POST | `/api/edit/page-numbers` | Add page numbers |
| POST | `/api/edit/crop` | Crop pages |
| POST | `/api/security/protect` | Encrypt with password |
| POST | `/api/security/unlock` | Remove password |
| GET  | `/api/files/:filename` | Download a processed file |
| GET  | `/health` | Health check |
