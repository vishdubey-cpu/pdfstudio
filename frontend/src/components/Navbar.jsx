import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handler)
    return () => window.removeEventListener('scroll', handler)
  }, [])

  useEffect(() => setOpen(false), [location])

  return (
    <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${
      scrolled ? 'bg-bg/90 backdrop-blur-xl border-b border-white/5' : 'bg-transparent'
    }`}>
      <div className="max-w-[1100px] mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="font-display text-xl font-bold text-accent tracking-tight">
          PDF<span className="text-muted font-normal">Studio</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          <Link to="/" className="text-muted hover:text-white text-sm font-medium transition-colors">Tools</Link>
          <a href="#" className="text-muted hover:text-white text-sm font-medium transition-colors">API</a>
          <a href="#" className="text-muted hover:text-white text-sm font-medium transition-colors">Pricing</a>
          <button className="btn-primary text-sm">Get started free</button>
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden text-muted hover:text-white" onClick={() => setOpen(!open)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-surface border-t border-white/5 px-6 py-4 flex flex-col gap-4">
          <Link to="/" className="text-sm text-muted hover:text-white">Tools</Link>
          <a href="#" className="text-sm text-muted hover:text-white">API</a>
          <a href="#" className="text-sm text-muted hover:text-white">Pricing</a>
          <button className="btn-primary text-sm w-fit">Get started free</button>
        </div>
      )}
    </nav>
  )
}
