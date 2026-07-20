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
  const prevRef = useRef<number | null>(null)


  // Track the newest callback so a re-render of the caller does not tear down
  // and restart the animation loop. This has to happen in an effect rather
  // than straight through render -- refs are not render-time state.
  useEffect(() => {
    callbackRef.current = callback
  }, [callback])


  useEffect(() => {
    if (!running) {
      return
    }

    let frame = 0
    prevRef.current = null // Reset on start

    // Declared inside the effect so it can schedule itself; a useCallback
    // cannot reference its own result before it is assigned.
    const run = () => {
      const now = Date.now()

      if (prevRef.current === null) {
        // First tick - just set the reference time
        prevRef.current = now
      } else {
        const delta = now - prevRef.current

        if (delta >= duration) {
          // Carry the overshoot forward rather than resetting to `now`. A beat
          // can only land on a frame boundary, so `now` is always 0-16ms late;
          // discarding that every beat is what made the tempo run slow.
          prevRef.current += duration

          if (now - prevRef.current >= duration) {
            // Still a whole beat behind: the loop was stalled, not merely late
            // (a backgrounded tab throttles or pauses rAF). Drop the missed
            // beats and resync, instead of machine-gunning to catch up.
            prevRef.current = now
          }

          callbackRef.current(delta)
        }
      }

      frame = requestAnimationFrame(run)
    }

    frame = requestAnimationFrame(run)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [running, duration])


  const start = useCallback(() => {
    setRunning(true)
  }, [])


  const stop = useCallback(() => {
    setRunning(false)
  }, [])


  return { running, start, stop, duration, setDuration }
}
