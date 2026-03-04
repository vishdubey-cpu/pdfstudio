import { useParams, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ArrowLeft, Shield, Lock, Zap, Globe } from 'lucide-react'
import { TOOLS } from '../utils/tools'
import { TOOL_SEO } from '../utils/seo'
import ToolModal from '../components/ToolModal'
import AdSlot from '../components/AdSlot'

const SITE_URL = 'https://pdfstudio1.netlify.app'
const SITE_NAME = 'PDF Studio'
const OG_IMAGE = `${SITE_URL}/og-image.png`

// Inject all head tags: title, meta, canonical, OG, Twitter
function useSEO({ title, description, keywords, canonical }) {
  useEffect(() => {
    if (title) document.title = title

    // Helper: get-or-create a <meta> tag
    function setMeta(selector, attr, attrVal, content) {
      let el = document.querySelector(selector)
      if (!el) {
        el = document.createElement('meta')
        el[attr] = attrVal
        document.head.appendChild(el)
      }
      el.content = content
    }

    // Helper: get-or-create a <link> tag
    function setLink(rel, href) {
      let el = document.querySelector(`link[rel="${rel}"]`)
      if (!el) {
        el = document.createElement('link')
        el.rel = rel
        document.head.appendChild(el)
      }
      el.href = href
    }

    if (description) setMeta('meta[name="description"]', 'name', 'description', description)
    if (keywords)    setMeta('meta[name="keywords"]',    'name', 'keywords',    keywords)

    // Canonical
    if (canonical) setLink('canonical', canonical)

    // Open Graph
    setMeta('meta[property="og:title"]',       'property', 'og:title',       title)
    setMeta('meta[property="og:description"]',  'property', 'og:description',  description || '')
    setMeta('meta[property="og:url"]',          'property', 'og:url',          canonical || SITE_URL)
    setMeta('meta[property="og:image"]',        'property', 'og:image',        OG_IMAGE)
    setMeta('meta[property="og:site_name"]',    'property', 'og:site_name',    SITE_NAME)
    setMeta('meta[property="og:type"]',         'property', 'og:type',         'website')

    // Twitter Card
    setMeta('meta[name="twitter:card"]',        'name', 'twitter:card',        'summary_large_image')
    setMeta('meta[name="twitter:title"]',       'name', 'twitter:title',       title)
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description || '')
    setMeta('meta[name="twitter:image"]',       'name', 'twitter:image',       OG_IMAGE)
  }, [title, description, keywords, canonical])
}

// Inject JSON-LD structured data blocks
function StructuredData({ tool, seo, toolUrl }) {
  const webApp = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: seo?.h1 || tool.name,
    description: seo?.description || tool.desc,
    url: toolUrl,
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

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'PDF Studio',
        item: SITE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'PDF Tools',
        item: `${SITE_URL}/`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: seo?.h1 || tool.name,
        item: toolUrl,
      },
    ],
  }

  const howTo = {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: `How to use ${seo?.h1 || tool.name}`,
    description: seo?.description || tool.desc,
    step: [
      {
        '@type': 'HowToStep',
        position: 1,
        name: 'Upload your file',
        text: `Click "Use ${tool.name} — Free" and select your file, or drag and drop it onto the upload area.`,
      },
      {
        '@type': 'HowToStep',
        position: 2,
        name: 'Configure settings',
        text: `Choose your preferred settings for the ${tool.name} operation and click Apply or Process.`,
      },
      {
        '@type': 'HowToStep',
        position: 3,
        name: 'Download the result',
        text: 'Your processed file is ready instantly. Click the Download button — no email or signup required.',
      },
    ],
  }

  const faqSchema = seo?.faqs?.length ? {
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(webApp) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howTo) }} />
      {faqSchema && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      )}
    </>
  )
}

const WHY_FEATURES = [
  { icon: Lock, title: 'Your files stay private', desc: 'All uploads are processed on our server and permanently deleted within 2 hours. We never read or share your documents.' },
  { icon: Shield, title: '100% free, no watermarks', desc: 'Every tool is completely free to use. We never add watermarks, logos, or branding to your output files.' },
  { icon: Globe, title: 'Works on any device', desc: 'No software to install. PDF Studio runs entirely in your browser on Windows, Mac, iOS, and Android.' },
  { icon: Zap, title: 'Lightning fast', desc: 'Powered by MuPDF and LibreOffice — professional-grade engines that process your files in seconds, not minutes.' },
]

export default function ToolPage() {
  const { toolId } = useParams()
  const navigate = useNavigate()
  const [modalOpen, setModalOpen] = useState(false)

  const tool = TOOLS.find(t => t.id === toolId)
  const seo = TOOL_SEO[toolId]
  const toolUrl = `${SITE_URL}/tools/${toolId}`

  useSEO({
    title: seo?.title || (tool ? `${tool.name} — Free Online | PDF Studio` : 'PDF Studio'),
    description: seo?.description || tool?.desc,
    keywords: seo?.keywords,
    canonical: tool ? toolUrl : SITE_URL,
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
      <StructuredData tool={tool} seo={seo} toolUrl={toolUrl} />

      {/* Breadcrumb */}
      <div className="max-w-[860px] mx-auto px-6 pt-28 pb-6">
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-2 text-sm text-muted">
            <li>
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-2 hover:text-white transition-colors"
              >
                <ArrowLeft size={14} />
                All PDF Tools
              </button>
            </li>
            <li aria-hidden="true" className="text-white/20">›</li>
            <li className="text-white/60 truncate">{seo?.h1 || tool.name}</li>
          </ol>
        </nav>
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

      {/* Why PDF Studio */}
      <section className="max-w-[860px] mx-auto px-6 pb-16">
        <h2 className="font-display text-2xl font-bold text-white mb-8 tracking-tight">
          Why use PDF Studio?
        </h2>
        <div className="grid sm:grid-cols-2 gap-5">
          {WHY_FEATURES.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-surface border border-white/7 rounded-2xl p-6 flex gap-4">
              <div className="shrink-0 w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center">
                <Icon size={16} className="text-white/60" />
              </div>
              <div>
                <div className="font-semibold text-white mb-1 text-[15px]">{title}</div>
                <div className="text-sm text-muted font-light leading-relaxed">{desc}</div>
              </div>
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
