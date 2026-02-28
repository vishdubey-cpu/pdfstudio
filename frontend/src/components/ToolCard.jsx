import { useNavigate } from 'react-router-dom'
import { COLOR_MAP } from '../utils/tools'

export default function ToolCard({ tool, onClick }) {
  const colors = COLOR_MAP[tool.color] || COLOR_MAP.accent
  const navigate = useNavigate()

  const handleClick = (e) => {
    // If user holds Ctrl/Cmd, navigate to tool page (for link behaviour)
    // Otherwise open modal directly for faster UX
    if (e.ctrlKey || e.metaKey) {
      navigate(`/tools/${tool.id}`)
    } else {
      onClick(tool)
    }
  }

  return (
    <a
      href={`/tools/${tool.id}`}
      onClick={e => { e.preventDefault(); handleClick(e) }}
      className="card text-left p-6 w-full group relative overflow-hidden block"
    >
      {/* Subtle radial highlight on hover */}
      <span className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: `radial-gradient(circle at 0% 0%, ${colors.bg.replace('0.12)', '0.06)')} 0%, transparent 60%)` }}
      />

      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-lg mb-4 font-mono font-bold relative"
        style={{ background: colors.bg, color: colors.text }}
      >
        {tool.icon}
      </div>

      <div className="font-medium text-[15px] text-white mb-1.5 relative">{tool.name}</div>
      <div className="text-sm text-muted font-light leading-relaxed relative">{tool.desc}</div>
    </a>
  )
}
