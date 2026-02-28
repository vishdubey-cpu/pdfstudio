// Run: node scripts/generate-sitemap.js
// Output: frontend/public/sitemap.xml

const fs = require('fs')
const path = require('path')

const DOMAIN = 'https://pdfstudio.app'

const TOOL_IDS = [
  'merge', 'split', 'remove-pages', 'extract-pages', 'rotate',
  'compress', 'repair', 'ocr',
  'jpg-to-pdf', 'word-to-pdf', 'ppt-to-pdf', 'excel-to-pdf',
  'pdf-to-jpg', 'pdf-to-word', 'pdf-to-ppt', 'pdf-to-excel', 'pdf-to-pdfa',
  'watermark', 'page-numbers', 'crop',
  'unlock', 'protect', 'sign', 'redact',
]

const urls = [
  { loc: DOMAIN, priority: '1.0', changefreq: 'weekly' },
  ...TOOL_IDS.map(id => ({
    loc: `${DOMAIN}/tools/${id}`,
    priority: '0.9',
    changefreq: 'monthly',
  })),
]

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
  </url>`).join('\n')}
</urlset>`

const outPath = path.join(__dirname, '../frontend/public/sitemap.xml')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, xml)
console.log(`✅ Sitemap written with ${urls.length} URLs → ${outPath}`)
