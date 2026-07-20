import { useCallback, useEffect, useRef } from 'react'

/** How long a single click rings, in seconds. */
const NOTE_LENGTH = 0.1

/**
 * Tone synthesis for the metronome click. Knows nothing about tempo or beats --
 * callers say exactly when, on the AudioContext clock, each note should sound.
 */
export default function useBeep() {
  const contextRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)

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

  const resumeAudio = useCallback(async () => {
    const ctx = contextRef.current
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume()
    }
  }, [])

  /** The audio hardware clock. The scheduler's only source of truth for time. */
  const audioTime = useCallback(() => contextRef.current?.currentTime ?? 0, [])

  /**
   * Schedules one click to sound at `when` (absolute AudioContext time).
   * Returns the oscillator so a caller can cancel a note it has committed to
   * but no longer wants -- see the scheduler's stop path.
   */
  const scheduleBeep = useCallback((when: number, accent = false) => {
    const ctx = contextRef.current
    const gain = gainRef.current
    if (!ctx || !gain) {
      return null
    }
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = accent ? 880 : 440
    g.gain.value = accent ? 1 : 0.5
    osc.connect(g)
    g.connect(gain)
    osc.start(when)
    // Ramp relative to this note's own start, not to ctx.currentTime -- the
    // note may be scheduled well into the future.
    g.gain.exponentialRampToValueAtTime(0.0001, when + NOTE_LENGTH)
    osc.stop(when + NOTE_LENGTH)
    return osc
  }, [])

  return { scheduleBeep, resumeAudio, audioTime }
}
