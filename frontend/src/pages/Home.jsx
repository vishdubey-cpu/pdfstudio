import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { TOOLS, CATEGORIES } from '../utils/tools'
import ToolCard from '../components/ToolCard'
import ToolModal from '../components/ToolModal'
import AdSlot from '../components/AdSlot'

const CATEGORY_SECTIONS = [
  { id: 'organize', label: 'Organize PDF' },
  { id: 'optimize', label: 'Optimize PDF' },
  { id: 'convert', label: 'Convert PDF' },
  { id: 'edit', label: 'Edit PDF' },
  { id: 'security', label: 'PDF Security' },
]

export default function Home() {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [activeTool, setActiveTool] = useState(null)

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return TOOLS.filter(t => {
      const catMatch = activeCategory === 'all' || t.category === activeCategory
      const searchMatch = !q || t.name.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || t.category.includes(q)
      return catMatch && searchMatch
    })
  }, [query, activeCategory])

  const isSearching = query.length > 0

  return (
    <div className="min-h-screen">
      {/* Ambient glow */}
      <div className="fixed top-0 right-0 w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(232,213,176,0.04) 0%, transparent 70%)' }}
      />

      {/* Hero */}
      <section className="pt-40 pb-12 px-6 max-w-[1100px] mx-auto">
        <p className="flex items-center gap-3 text-xs font-medium tracking-[2px] uppercase text-muted mb-7">
          <span className="w-5 h-px bg-accent2" />
          All PDF tools, one place
        </p>

        <h1 className="font-display text-[clamp(44px,7vw,82px)] font-bold leading-[1.05] tracking-tight text-white mb-6 max-w-[700px]">
          Work with PDFs<br />the <em className="italic text-accent">elegant</em> way
        </h1>

        <p className="text-lg font-light text-muted max-w-[440px] leading-relaxed mb-12">
          {TOOLS.length} tools. Zero friction. No installs, no account required.
          Every file auto-deleted after 2 hours.
        </p>

        {/* Search */}
        <div className="flex items-center gap-3 bg-surface border border-white/10 rounded-2xl px-4 py-3 max-w-[500px] focus-within:border-accent/30 focus-within:shadow-[0_0_0_4px_rgba(232,213,176,0.05)] transition-all duration-200">
          <Search size={16} className="text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tools… compress, merge, sign"
            className="bg-transparent text-white text-[15px] w-full outline-none placeholder-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-muted hover:text-white text-xs">✕</button>
          )}
        </div>
      </section>

      {/* Ad — Leaderboard below hero */}
      <div className="px-6 max-w-[1100px] mx-auto mb-8">
        <AdSlot slot="1111111111" format="responsive" />
      </div>

      {/* Category filters */}
      <div className="px-6 max-w-[1100px] mx-auto mb-8 flex gap-2 flex-wrap">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-4 py-1.5 rounded-full text-[13px] font-medium border transition-all duration-200 ${
              activeCategory === cat.id
                ? 'bg-accent border-accent text-bg'
                : 'bg-transparent border-white/10 text-muted hover:border-white/20 hover:text-white'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Tools */}
      <section className="px-6 max-w-[1100px] mx-auto pb-24">
        {isSearching ? (
          <>
            {filtered.length === 0 ? (
              <div className="text-center py-20 text-muted">
                <p className="text-4xl mb-4">¯\_(ツ)_/¯</p>
                <p>No tools found for "<span className="text-white">{query}</span>"</p>
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted mb-4">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                  {filtered.map(tool => (
                    <ToolCard key={tool.id} tool={tool} onClick={setActiveTool} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          CATEGORY_SECTIONS.map(section => {
            const tools = filtered.filter(t => t.category === section.id)
            if (tools.length === 0) return null
            return (
              <div key={section.id} className="mb-12">
                <div className="flex items-center gap-4 mb-4">
                  <span className="text-[11px] font-semibold tracking-[2.5px] uppercase text-muted">
                    {section.label}
                  </span>
                  <span className="flex-1 h-px bg-white/5" />
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                  {tools.map(tool => (
                    <ToolCard key={tool.id} tool={tool} onClick={setActiveTool} />
                  ))}
                </div>
              </div>
            )
          })
        )}
      </section>

      {/* Stats */}
      <div className="max-w-[1100px] mx-auto px-6 pb-16 border-t border-white/5 pt-14">

        {/* Ad — Rectangle above stats (high RPM position) */}
        <div className="flex justify-center mb-12">
          <AdSlot slot="2222222222" format="rectangle" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { num: `${TOOLS.length}`, label: 'PDF tools in one place' },
            { num: '100%', label: 'Free for core tools' },
            { num: '2hr', label: 'Auto file deletion' },
            { num: '256-bit', label: 'SSL on all transfers' },
          ].map(s => (
            <div key={s.label}>
              <div className="font-display text-4xl font-bold text-white tracking-tight mb-1">{s.num}</div>
              <div className="text-sm text-muted font-light">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Banner */}
      <div className="max-w-[1020px] mx-auto px-6 pb-24">
        <div className="bg-surface border border-white/7 rounded-3xl p-10 md:p-14 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          <div>
            <h2 className="font-display text-3xl font-bold text-white tracking-tight mb-2">
              Get more with Studio Pro
            </h2>
            <p className="text-muted font-light text-[15px]">
              Unlimited file sizes · Batch processing · Custom workflows · Offline desktop app
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <button className="btn-ghost">See features</button>
            <button className="btn-primary">Start free trial</button>
          </div>
        </div>
      </div>

      {/* SEO Content Block — critical for ranking */}
      <div className="max-w-[860px] mx-auto px-6 pb-24">
        <div className="border-t border-white/5 pt-16 space-y-12">

          <div>
            <h2 className="font-display text-2xl font-bold text-white mb-4 tracking-tight">
              Free Online PDF Tools — No Download Required
            </h2>
            <p className="text-muted font-light leading-relaxed text-[15px]">
              PDF Studio gives you every tool you need to work with PDF files directly in your browser.
              Merge PDF files, split large documents, compress PDFs to reduce file size, convert PDF to Word,
              Excel, PowerPoint, and JPG — all for free, with no software installation and no account required.
              Your files are processed securely and automatically deleted after 2 hours.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h3 className="font-semibold text-white mb-3 text-[15px]">How to Merge PDF Files</h3>
              <p className="text-muted text-sm font-light leading-relaxed">
                Upload two or more PDF files using the Merge PDF tool. Drag to reorder them,
                then click Merge. Your combined PDF is ready to download in seconds.
                No file size limits on the free plan up to 10MB per file.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-3 text-[15px]">How to Compress a PDF</h3>
              <p className="text-muted text-sm font-light leading-relaxed">
                Upload your PDF and choose your compression level — low, medium, or high.
                Our compressor reduces PDF file size by re-encoding embedded images while
                preserving text quality. Ideal for email attachments and web uploads.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-3 text-[15px]">How to Convert PDF to Word</h3>
              <p className="text-muted text-sm font-light leading-relaxed">
                Upload any PDF and convert it to an editable DOCX file. Our PDF to Word
                converter preserves formatting, fonts, and layout as accurately as possible.
                Download your Word document instantly after conversion.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-white mb-3 text-[15px]">Is PDF Studio Secure?</h3>
              <p className="text-muted text-sm font-light leading-relaxed">
                All file transfers use 256-bit SSL encryption. Your files are stored temporarily
                on secure servers and permanently deleted within 2 hours of processing.
                We never read, share, or sell your document contents.
              </p>
            </div>
          </div>

          {/* FAQ — targets "People Also Ask" in Google */}
          <div>
            <h2 className="font-display text-2xl font-bold text-white mb-6 tracking-tight">
              Frequently Asked Questions
            </h2>
            <div className="space-y-6">
              {[
                {
                  q: 'Can I merge PDF files for free?',
                  a: 'Yes. PDF Studio\'s Merge PDF tool is completely free. Upload up to 20 PDF files, arrange them in any order, and download the merged result instantly with no watermark added.'
                },
                {
                  q: 'How do I reduce PDF file size without losing quality?',
                  a: 'Use our Compress PDF tool. Upload your PDF and select Medium compression for the best balance of file size and quality. Most PDFs are reduced by 40–70% without visible quality loss.'
                },
                {
                  q: 'Can I convert a scanned PDF to text?',
                  a: 'Yes. Use our OCR PDF tool to extract text from scanned documents. It supports English, Hindi, French, German, Spanish and more languages.'
                },
                {
                  q: 'How do I split a PDF into multiple files?',
                  a: 'Upload your PDF to the Split PDF tool and choose whether to split every page into individual files, or define custom page ranges such as 1-3, 4-6. Download all parts as a ZIP file.'
                },
                {
                  q: 'Is there a file size limit?',
                  a: 'Free users can process files up to 10MB per operation. Studio Pro users get unlimited file sizes, batch processing, and priority processing speed.'
                },
                {
                  q: 'Do I need to create an account?',
                  a: 'No account is required for any free tool. Simply upload your file, process it, and download the result. Accounts are optional and unlock saved history and Pro features.'
                },
              ].map((item, i) => (
                <details key={i} className="group border-b border-white/5 pb-6">
                  <summary className="text-[15px] font-medium text-white cursor-pointer flex items-center justify-between list-none">
                    {item.q}
                    <span className="text-muted group-open:rotate-180 transition-transform duration-200 text-lg">↓</span>
                  </summary>
                  <p className="text-sm text-muted font-light leading-relaxed mt-3">{item.a}</p>
                </details>
              ))}
            </div>
          </div>

          {/* Bottom ad — highest intent, user has read the page */}
          <AdSlot slot="3333333333" format="responsive" />

        </div>
      </div>

      {/* Tool modal */}
      {activeTool && (
        <ToolModal tool={activeTool} onClose={() => setActiveTool(null)} />
      )}
    </div>
  )
}
