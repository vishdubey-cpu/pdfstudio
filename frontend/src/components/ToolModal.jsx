import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { X, Upload, Download, CheckCircle, AlertCircle, Loader2, Shield, ArrowRight } from 'lucide-react'
import { submitJob, getDownloadUrl } from '../utils/api'
import { COLOR_MAP, TOOLS } from '../utils/tools'
import AdSlot from './AdSlot'

const SUGGESTED_TOOL_IDS = ['merge', 'split', 'compress', 'protect', 'watermark', 'pdf-to-jpg', 'rotate', 'word-to-pdf']

function FieldInput({ field, value, onChange }) {
  if (field.type === 'hidden') return null
  if (field.type === 'select') return (
    <div>
      <label className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{field.label}</label>
      <select
        value={value ?? field.options[0]?.value ?? ''}
        onChange={e => onChange(field.name, e.target.value)}
        className="w-full bg-bg border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent/40 transition-colors"
      >
        {field.options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
  if (field.type === 'range') return (
    <div>
      <label className="block text-xs text-muted mb-1.5 uppercase tracking-wider">
        {field.label}: <span className="text-accent">{value ?? field.defaultValue}</span>
      </label>
      <input
        type="range"
        min={field.min} max={field.max} step={field.step}
        value={value ?? field.defaultValue}
        onChange={e => onChange(field.name, e.target.value)}
        className="w-full accent-accent"
      />
    </div>
  )
  if (field.type === 'color') return (
    <div>
      <label className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{field.label}</label>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value ?? field.defaultValue ?? '#000000'}
          onChange={e => onChange(field.name, e.target.value)}
          className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent"
        />
        <span className="text-sm font-mono text-muted">{value ?? field.defaultValue ?? '#000000'}</span>
      </div>
    </div>
  )
  return (
    <div>
      <label className="block text-xs text-muted mb-1.5 uppercase tracking-wider">{field.label}</label>
      <input
        type={field.type || 'text'}
        value={value ?? ''}
        onChange={e => onChange(field.name, e.target.value)}
        placeholder={field.placeholder}
        required={field.required}
        className="w-full bg-bg border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-muted focus:outline-none focus:border-accent/40 transition-colors"
      />
    </div>
  )
}

export default function ToolModal({ tool, onClose }) {
  const navigate = useNavigate()
  const [files, setFiles] = useState([])
  const [fields, setFields] = useState(() => {
    const init = {}
    tool.fields.forEach(f => {
      if (f.type === 'hidden') init[f.name] = f.value
      else if (f.defaultValue) init[f.name] = f.defaultValue
      else if (f.type === 'select') init[f.name] = f.options?.[0]?.value
    })
    return init
  })
  const [status, setStatus] = useState('idle') // idle | uploading | processing | done | error
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const colors = COLOR_MAP[tool.color] || COLOR_MAP.accent

  const onDrop = useCallback(accepted => {
    setFiles(prev => tool.multiFile ? [...prev, ...accepted] : accepted)
    setStatus('idle')
    setResult(null)
    setError('')
  }, [tool.multiFile])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: tool.accepts ? { '*/*': tool.accepts.split(',') } : undefined,
    multiple: !!tool.multiFile,
  })

  const setField = (name, value) => setFields(prev => ({ ...prev, [name]: value }))

  const removeFile = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i))

  const handleSubmit = async () => {
    if (files.length === 0) return
    setStatus('uploading')
    setProgress(0)
    setError('')
    try {
      const data = await submitJob(tool.endpoint, files, fields, (pct) => {
        setProgress(pct)
        if (pct === 100) setStatus('processing')
      })
      setResult(data)
      setStatus('done')
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Something went wrong.')
      setStatus('error')
    }
  }

  // Close on backdrop click
  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose() }

  const visibleFields = tool.fields.filter(f => {
    if (f.type === 'hidden') return false
    if (f.dependsOn) {
      return Object.entries(f.dependsOn).every(([k, v]) => fields[k] === v)
    }
    return true
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      onClick={handleBackdrop}
    >
      <div className="bg-surface border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in">
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-0">
          <div>
            <div
              className="inline-block text-xs font-semibold tracking-widest uppercase px-3 py-1 rounded-full mb-3"
              style={{ background: colors.bg, color: colors.text }}
            >
              {tool.category}
            </div>
            <h2 className="font-display text-2xl font-bold text-white tracking-tight">{tool.name}</h2>
            <p className="text-sm text-muted mt-1">{tool.desc}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors p-1 mt-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Drop zone */}
          {status !== 'done' && (
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
                isDragActive
                  ? 'border-accent/60 bg-accent/5'
                  : 'border-white/10 hover:border-white/20 hover:bg-white/[0.02]'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="mx-auto mb-3 text-muted" size={28} />
              <p className="text-sm font-medium text-white mb-1">
                {isDragActive ? 'Drop it here' : 'Drop your file here'}
              </p>
              <p className="text-xs text-muted">
                or <span className="text-accent underline">browse files</span>
                {tool.accepts && ` · ${tool.accepts}`}
              </p>
            </div>
          )}

          {/* File list */}
          {files.length > 0 && status !== 'done' && (
            <div className="space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-3 bg-bg rounded-xl px-4 py-2.5">
                  <div className="text-xs font-mono text-muted truncate flex-1">{f.name}</div>
                  <div className="text-xs text-muted">{(f.size / 1024).toFixed(0)} KB</div>
                  <button onClick={() => removeFile(i)} className="text-muted hover:text-white">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Fields */}
          {visibleFields.length > 0 && status !== 'done' && (
            <div className="space-y-4">
              {visibleFields.map(field => (
                <FieldInput key={field.name} field={field} value={fields[field.name]} onChange={setField} />
              ))}
            </div>
          )}

          {/* Progress */}
          {(status === 'uploading' || status === 'processing') && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-muted">
                <Loader2 size={16} className="animate-spin text-accent" />
                {status === 'uploading' ? `Uploading… ${progress}%` : 'Processing your file…'}
              </div>
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-300"
                  style={{ width: status === 'processing' ? '100%' : `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <AlertCircle size={16} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Success */}
          {status === 'done' && result && (() => {
            const reducedBy = result.stats?.find(s => s.label === 'Reduced by')
            const origSize  = result.stats?.find(s => s.label === 'Original size')
            const newSize   = result.stats?.find(s => s.label === 'New size')
            const isCompress = !!(reducedBy && origSize && newSize)
            const alreadyOptimized = result.alreadyOptimized || reducedBy?.value === '0%'
            const suggestedTools = SUGGESTED_TOOL_IDS
              .filter(id => id !== tool.id)
              .slice(0, 4)
              .map(id => TOOLS.find(t => t.id === id))
              .filter(Boolean)

            return (
              <div className="py-2">
                {/* Header */}
                <div className="text-center mb-5">
                  <CheckCircle className="mx-auto mb-3 text-green-400" size={36} />
                  <h3 className="font-display text-xl font-bold text-white">Done!</h3>
                </div>

                {/* Compression savings badge */}
                {isCompress && !alreadyOptimized && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-4 mb-5 text-center">
                    <div className="text-4xl font-bold text-green-400 leading-none mb-1">
                      {reducedBy.value} smaller
                    </div>
                    <div className="text-sm text-white/60 mt-2">
                      {origSize.value} &rarr; {newSize.value}
                    </div>
                  </div>
                )}

                {/* Already optimized notice */}
                {isCompress && alreadyOptimized && (
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 mb-5 text-center">
                    <div className="text-base font-semibold text-white mb-1">Already optimized</div>
                    <div className="text-sm text-muted">
                      This PDF is already highly compressed — no further reduction was possible.
                    </div>
                    <div className="text-xs text-white/40 mt-2">{origSize.value}</div>
                  </div>
                )}

                {/* Stats grid for non-compress tools */}
                {result.stats && !isCompress && (
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {result.stats.map((s, i) => (
                      <div key={i} className="bg-bg rounded-xl px-3 py-2.5">
                        <div className="text-xs text-muted mb-0.5">{s.label}</div>
                        <div className="text-sm font-semibold text-white">{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* OCR text result */}
                {result.fullText && (
                  <div className="mb-4 text-left">
                    <label className="block text-xs text-muted mb-2 uppercase tracking-wider">Extracted text</label>
                    <textarea
                      readOnly
                      value={result.fullText}
                      rows={6}
                      className="w-full bg-bg border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono resize-none focus:outline-none"
                    />
                    <button
                      onClick={() => navigator.clipboard.writeText(result.fullText)}
                      className="btn-ghost mt-2 text-xs"
                    >
                      Copy text
                    </button>
                  </div>
                )}

                {/* Download button */}
                {result.url && (
                  <a
                    href={getDownloadUrl(result.file)}
                    download
                    className="btn-primary inline-flex items-center justify-center gap-2 text-sm w-full mb-2"
                  >
                    <Download size={15} />
                    {isCompress ? 'Download compressed PDF' : `Download ${tool.name.toLowerCase()}`}
                  </a>
                )}

                <button
                  onClick={() => { setStatus('idle'); setFiles([]); setResult(null) }}
                  className="btn-ghost text-sm w-full mb-5"
                >
                  Process another file
                </button>

                {/* Continue with... */}
                <div className="border-t border-white/5 pt-4">
                  <p className="text-xs text-muted uppercase tracking-wider mb-3">Continue with...</p>
                  <div className="grid grid-cols-2 gap-2">
                    {suggestedTools.map(t => (
                      <button
                        key={t.id}
                        onClick={() => { onClose(); navigate(`/tools/${t.id}`) }}
                        className="flex items-center justify-between bg-bg hover:bg-white/5 rounded-xl px-3 py-2.5 text-left transition-colors group"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm shrink-0">{t.icon}</span>
                          <span className="text-xs text-white truncate">{t.name}</span>
                        </div>
                        <ArrowRight size={12} className="text-muted group-hover:text-white transition-colors shrink-0 ml-1" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Ad */}
                <div className="mt-5">
                  <AdSlot slot="4444444444" format="rectangle" />
                </div>
              </div>
            )
          })()}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Shield size={12} />
            Files auto-deleted after 2 hours
          </div>
          {status !== 'done' && (
            <button
              onClick={handleSubmit}
              disabled={files.length === 0 || status === 'uploading' || status === 'processing'}
              className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status === 'uploading' || status === 'processing' ? 'Processing…' : `Apply ${tool.name}`}
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes animate-in {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .animate-in { animation: animate-in 0.25s cubic-bezier(0.4,0,0.2,1); }
      `}</style>
    </div>
  )
}
