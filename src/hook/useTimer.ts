import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Calls the provided callback every `duration` milliseconds while running.
 * The timer can be started, stopped and the duration may be changed.
 */
export default function useTimer(
  callback: (delta: number) => void,
  initialDuration: number,
) {
  const [duration, setDuration] = useState(initialDuration)
  const [running, setRunning] = useState(false)


  const callbackRef = useRef(callback)
  const frameRef = useRef<number | null>(null)
  const prevRef = useRef<number | null>(null)

  callbackRef.current = callback

  const run = useCallback(() => {
    const now = Date.now()
    
    if (prevRef.current === null) {
      // First tick - just set the reference time
      prevRef.current = now
      frameRef.current = requestAnimationFrame(run)
      return
    }
    
    const prev = prevRef.current
    const delta = now - prev


    if (delta >= duration) {
      prevRef.current = now
      callbackRef.current(delta)
    }

    frameRef.current = requestAnimationFrame(run)
  }, [duration])


  useEffect(() => {
    if (!running) {
      return
    }

    prevRef.current = null // Reset on start
    frameRef.current = requestAnimationFrame(run)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
    }
  }, [running, run])


  const start = useCallback(() => {
    setRunning(true)
  }, [])
  

  const stop = useCallback(() => {
    setRunning(false)
  }, [])


  return { running, start, stop, duration, setDuration }
}
