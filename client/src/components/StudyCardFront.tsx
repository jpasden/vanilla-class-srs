import { useLayoutEffect, useRef } from 'react'

const PREFERRED_SIZE = 'clamp(32px, 8vw, 48px)'
const MINIMUM_SIZE = 22

export default function StudyCardFront({ word, pos, flipped }: {
  word: string
  pos: string | null
  flipped: boolean
}) {
  const faceRef = useRef<HTMLDivElement>(null)
  const wordRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const face = faceRef.current
    const text = wordRef.current
    if (!face || !text) return
    let frame: number | null = null
    let disposed = false
    const number = (value: string) => parseFloat(value) || 0
    const fit = () => {
      // Always start at the preferred size, so a short next card grows back.
      text.style.fontSize = PREFERRED_SIZE
      text.style.whiteSpace = 'normal'
      const faceStyle = getComputedStyle(face)
      const textStyle = getComputedStyle(text)
      const width = face.clientWidth - number(faceStyle.paddingLeft) - number(faceStyle.paddingRight) - 2
      const siblingsHeight = Array.from(face.children).reduce((height, child) => {
        if (child === text) return height
        const style = getComputedStyle(child)
        return height + (child as HTMLElement).offsetHeight + number(style.marginTop) + number(style.marginBottom)
      }, 0)
      const height = face.clientHeight - number(faceStyle.paddingTop) - number(faceStyle.paddingBottom)
        - number(textStyle.marginTop) - number(textStyle.marginBottom) - siblingsHeight
      if (width <= 0 || height <= 0) return
      text.style.maxWidth = `${width}px`
      const preferred = number(textStyle.fontSize)
      const fits = () => text.scrollWidth <= width + 0.5 && text.offsetHeight <= height

      // Keep individual words intact; phrases can wrap naturally at spaces.
      const singleWord = !/\s/.test(word.trim())
      if (singleWord) text.style.whiteSpace = 'nowrap'
      if (fits()) return
      text.style.fontSize = `${MINIMUM_SIZE}px`
      if (!fits()) {
        // Never make an exceptionally long word unreadably small.
        // Wrap at the minimum, with scrolling available for extreme content.
        text.style.whiteSpace = 'normal'
        return
      }
      let low = MINIMUM_SIZE, high = preferred
      while (high - low > 0.1) {
        const mid = (low + high) / 2
        text.style.fontSize = `${mid}px`
        if (fits()) low = mid
        else high = mid
      }
      text.style.fontSize = `${Math.floor(low * 10) / 10}px`
    }
    const schedule = () => {
      if (disposed || frame !== null) return
      frame = requestAnimationFrame(() => { frame = null; fit() })
    }
    fit()
    const observer = new ResizeObserver(schedule)
    observer.observe(face)
    window.addEventListener('resize', schedule)
    document.fonts.addEventListener('loadingdone', schedule)
    void document.fonts.ready.then(schedule)
    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.fonts.removeEventListener('loadingdone', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [word, pos])

  return (
    <div
      ref={faceRef}
      className="review-flip-face review-card-front"
      style={{
        background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12,
        padding: 'clamp(20px, 5vw, 40px) clamp(16px, 4vw, 32px)', textAlign: 'center',
        cursor: flipped ? 'default' : 'pointer', height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'safe center', boxShadow: 'var(--shadow-sm)', overflowY: 'auto',
      }}
    >
      <div ref={wordRef} className="review-card-word" style={{
        fontSize: PREFERRED_SIZE, fontWeight: 800, marginBottom: 8, maxWidth: '100%',
        overflowWrap: 'anywhere', flexShrink: 0,
      }}>{word}</div>
      {pos && (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', fontStyle: 'italic', flexShrink: 0 }}>{pos}</div>
      )}
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 24, flexShrink: 0 }}>Tap to reveal</p>
    </div>
  )
}
