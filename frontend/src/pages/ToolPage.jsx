import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ArrowLeft, Shield } from 'lucide-react'
import { TOOLS } from '../utils/tools'
import { TOOL_SEO } from '../utils/seo'
import ToolModal from '../components/ToolModal'
import AdSlot from '../components/AdSlot'

// Inject <title> and <meta description> dynamically
function useSEO({ title, description, keywords }) {
  useEffect(() => {
    if (title) document.title = title
    let meta = document.querySelector('meta[name="description"]')
    if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.appendChild(meta) }
    if (description) meta.content = description

    let metaKw = document.querySelector('meta[name="keywords"]')
    if (!metaKw) { metaKw = document.createElement('meta'); metaKw.name = 'keywords'; document.head.appendChild(metaKw) }
    if (keywords) metaKw.content = keywords
  }, [title, description, keywords])
}

// Inject JSON-LD structured data
function StructuredData({ tool, seo }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: seo?.h1 || tool.name,
    description: seo?.description || tool.desc,
    url: `https://pdfstudio.app/tools/${tool.id}`,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Web Browser',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    featureList: [
      'No file size limits on free plan',
      'No watermark added',
      'Files deleted after 2 hours',
      'No account required',
      '256-bit SSL encryption',
    ],
  }

  const faqJsonLd = seo?.faqs?.length ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: seo.faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  } : null

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {faqJsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      )}
    </>
  )
}

export default function ToolPage() {
  const { toolId } = useParams()
  const navigate = useNavigate()
  const [modalOpen, setModalOpen] = useState(false)

  const tool = TOOLS.find(t => t.id === toolId)
  const seo = TOOL_SEO[toolId]

  useSEO({
    title: seo?.title || (tool ? `${tool.name} — Free Online | PDF Studio` : 'PDF Studio'),
    description: seo?.description || tool?.desc,
    keywords: seo?.keywords,
  })

  if (!tool) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-4">404</p>
          <p className="text-muted mb-6">Tool not found</p>
          <button onClick={() => navigate('/')} className="btn-primary">Back to all tools</button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <StructuredData tool={tool} seo={seo} />

      {/* Breadcrumb */}
      <div className="max-w-[860px] mx-auto px-6 pt-28 pb-6">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors"
        >
          <ArrowLeft size={14} />
          All PDF Tools
        </button>
      </div>

      {/* Hero */}
      <section className="max-w-[860px] mx-auto px-6 pb-12">
        <h1 className="font-display text-[clamp(32px,5vw,56px)] font-bold text-white tracking-tight leading-tight mb-4">
          {seo?.h1 || tool.name}
        </h1>
        <p className="text-lg text-muted font-light leading-relaxed max-w-[580px] mb-8">
          {seo?.intro || tool.desc}
        </p>

        {/* CTA */}
        <button
          onClick={() => setModalOpen(true)}
          className="btn-primary text-base px-8 py-3 text-[15px]"
        >
          Use {tool.name} — Free
        </button>

        <div className="flex items-center gap-6 mt-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><Shield size={12} /> No signup required</span>
          <span>· Files deleted in 2 hours</span>
          <span>· No watermark</span>
        </div>
      </section>

      {/* Ad — below CTA, high viewability */}
      <div className="max-w-[860px] mx-auto px-6 mb-12">
        <AdSlot slot="5555555555" format="responsive" />
      </div>

      {/* How it works */}
      <section className="max-w-[860px] mx-auto px-6 pb-16">
        <h2 className="font-display text-2xl font-bold text-white mb-8 tracking-tight">
          How to use {tool.name}
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { step: '1', title: 'Upload your file', desc: `Click the button above and select your ${tool.accepts?.split(',')[0]?.replace('.','')?.toUpperCase() || 'PDF'} file, or drag and drop it.` },
            { step: '2', title: 'Set your options', desc: `Choose your preferred settings for the ${tool.name} operation, then click Apply.` },
            { step: '3', title: 'Download your result', desc: 'Your processed file is ready instantly. Download it directly — no email required.' },
          ].map(s => (
            <div key={s.step} className="bg-surface border border-white/7 rounded-2xl p-6">
              <div className="font-mono text-xs text-muted mb-3">Step {s.step}</div>
              <div className="font-semibold text-white mb-2">{s.title}</div>
              <div className="text-sm text-muted font-light leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      {seo?.faqs?.length > 0 && (
        <section className="max-w-[860px] mx-auto px-6 pb-16">
          <h2 className="font-display text-2xl font-bold text-white mb-6 tracking-tight">
            Frequently Asked Questions
          </h2>
          <div className="space-y-5">
            {seo.faqs.map((item, i) => (
              <details key={i} className="group border-b border-white/5 pb-5">
                <summary className="text-[15px] font-medium text-white cursor-pointer flex items-center justify-between list-none">
                  {item.q}
                  <span className="text-muted group-open:rotate-180 transition-transform duration-200 text-lg">↓</span>
                </summary>
                <p className="text-sm text-muted font-light leading-relaxed mt-3">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Related tools */}
      <section className="max-w-[860px] mx-auto px-6 pb-16">
        <h2 className="font-display text-xl font-bold text-white mb-5 tracking-tight">
          Related PDF Tools
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TOOLS.filter(t => t.id !== tool.id && t.category === tool.category)
            .slice(0, 4)
            .map(related => (
              <button
                key={related.id}
                onClick={() => navigate(`/tools/${related.id}`)}
                className="bg-surface border border-white/7 rounded-xl p-4 text-left hover:border-white/15 transition-all"
              >
                <div className="text-lg mb-2">{related.icon}</div>
                <div className="text-sm font-medium text-white">{related.name}</div>
              </button>
            ))}
        </div>
      </section>

      {/* Bottom ad */}
      <div className="max-w-[860px] mx-auto px-6 pb-20">
        <AdSlot slot="6666666666" format="rectangle" />
      </div>

      {/* Modal */}
      {modalOpen && <ToolModal tool={tool} onClose={() => setModalOpen(false)} />}
    </div>
  )
}
