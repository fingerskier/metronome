import { useCallback } from 'react'

/**
 * The app's only door to the Vibration API.
 *
 * Deliberately dumb: it neither builds patterns nor decides when to fire. The
 * scheduler owns both, because a buzz has to be committed ahead of time on the
 * same grid as the click.
 */
export default function useVibrate() {
  /**
   * Hands one whole run of beats to the OS vibrator.
   *
   * The returned boolean is the API's own refusal signal -- a hidden document,
   * absent vibration hardware, or a permissions policy all yield false. Callers
   * must treat false as "these beats are NOT covered" and retry, rather than
   * assuming the pattern is running.
   */
  const vibrateBatch = useCallback((pattern: readonly number[]) => {
    if (!('vibrate' in navigator)) return false
    if (pattern.length === 0) return false
    // `!== false` rather than `=== true`: some user agents return undefined.
    return navigator.vibrate([...pattern]) !== false
  }, [])

  /** Stops whatever is running. A committed pattern outlives Stop otherwise. */
  const cancelVibration = useCallback(() => {
    if (!('vibrate' in navigator)) return
    navigator.vibrate(0)
  }, [])

  return { vibrateBatch, cancelVibration }
}
