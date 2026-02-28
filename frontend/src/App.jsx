import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import ToolPage from './pages/ToolPage'
import { AdSenseScript } from './components/AdSlot'

function Footer() {
  return (
    <footer className="border-t border-white/5 px-6 py-8 max-w-[1100px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
      <span className="font-display text-lg text-accent font-bold">PDFStudio</span>
      <div className="flex gap-6 text-xs text-muted">
        {['Privacy', 'Terms', 'Security', 'API', 'Contact'].map(l => (
          <a key={l} href="#" className="hover:text-white transition-colors">{l}</a>
        ))}
      </div>
      <span className="font-mono text-xs text-muted">© 2026 PDF Studio</span>
    </footer>
  )
}

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <AdSenseScript />
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tools/:toolId" element={<ToolPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  )
}
