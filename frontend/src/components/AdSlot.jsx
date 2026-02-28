import { useEffect, useRef } from 'react'

// Replace these with your real AdSense publisher ID and slot IDs
const PUBLISHER_ID = 'ca-pub-XXXXXXXXXXXXXXXXX'

const AD_SIZES = {
  leaderboard:  { width: 728, height: 90,  label: '728×90 Leaderboard' },
  rectangle:    { width: 336, height: 280, label: '336×280 Rectangle' },
  banner:       { width: 468, height: 60,  label: '468×60 Banner' },
  responsive:   { width: null, height: null, label: 'Responsive' },
}

/**
 * AdSlot — drops a Google AdSense unit
 * Props:
 *   slot      — AdSense slot ID (string)
 *   format    — 'leaderboard' | 'rectangle' | 'banner' | 'responsive'
 *   className — extra Tailwind classes
 *   label     — show "Advertisement" label above (default true)
 */
export default function AdSlot({ slot = '1234567890', format = 'responsive', className = '', label = true }) {
  const ref = useRef(null)
  const size = AD_SIZES[format] || AD_SIZES.responsive

  useEffect(() => {
    // Push ad after mount — standard AdSense pattern
    try {
      if (window.adsbygoogle) {
        window.adsbygoogle.push({})
      }
    } catch (e) {
      // AdSense not loaded yet (dev mode) — silently ignore
    }
  }, [])

  return (
    <div className={`flex flex-col items-center ${className}`}>
      {label && (
        <p className="text-[10px] text-muted uppercase tracking-widest mb-1.5">Advertisement</p>
      )}
      <div
        ref={ref}
        className="overflow-hidden rounded-xl"
        style={size.width ? { width: size.width, height: size.height } : { width: '100%' }}
      >
        <ins
          className="adsbygoogle"
          style={size.width
            ? { display: 'inline-block', width: size.width, height: size.height }
            : { display: 'block' }
          }
          data-ad-client={PUBLISHER_ID}
          data-ad-slot={slot}
          data-ad-format={size.width ? undefined : 'auto'}
          data-full-width-responsive={size.width ? undefined : 'true'}
        />
      </div>
    </div>
  )
}

/**
 * AdSenseScript — add once to index.html or App.jsx
 * <AdSenseScript /> in your <head> equivalent
 */
export function AdSenseScript() {
  useEffect(() => {
    if (document.querySelector('script[data-adsense]')) return
    const script = document.createElement('script')
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${PUBLISHER_ID}`
    script.async = true
    script.crossOrigin = 'anonymous'
    script.setAttribute('data-adsense', 'true')
    document.head.appendChild(script)
  }, [])
  return null
}
