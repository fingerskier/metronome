import { useCallback, useEffect, useRef } from 'react'

/**
 * Returns a function that plays a short beep. When `accent` is true a louder
 * beep with a higher frequency is produced.
 */
export default function useBeep() {
  const contextRef = useRef<AudioContext>()
  const gainRef = useRef<GainNode>()

  useEffect(() => {
    const ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    const ctx = new ctor()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    contextRef.current = ctx
    gainRef.current = gain
    return () => {
      ctx.close()
    }
  }, [])

  return useCallback((accent = false) => {
    const ctx = contextRef.current
    const gain = gainRef.current
    if (!ctx || !gain) return
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = accent ? 880 : 440
    g.gain.value = accent ? 1 : 0.5
    osc.connect(g)
    g.connect(gain)
    osc.start()
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1)
    osc.stop(ctx.currentTime + 0.1)
  }, [])
}
