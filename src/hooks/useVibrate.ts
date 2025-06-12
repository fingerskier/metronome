import { useCallback } from 'react'

/**
 * Returns a function that triggers a vibration pattern. When accent is true a
 * longer vibration is used.
 */
export default function useVibrate() {
  return useCallback((accent = false) => {
    if (!('vibrate' in navigator)) return
    navigator.vibrate(accent ? 50 : 20)
  }, [])
}
