import { useEffect } from 'react'

// Structural types rather than lib.dom's WakeLock/WakeLockSentinel: those are
// missing from some TS DOM libs, and everything here is feature-detected
// anyway.
type WakeLockSentinelLike = {
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
  removeEventListener: (type: 'release', listener: () => void) => void
}

type WakeLockLike = {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

/**
 * Holds a screen wake lock while `active`.
 *
 * This is not a convenience -- it is the only thing keeping vibration alive at
 * all. Per the Vibration API a hidden document cannot start a pattern, and the
 * user agent MUST abort a running one the moment visibility changes. Screen off
 * means hidden means zero haptics, however far ahead the pattern was committed.
 * Do not "optimise" this away.
 */
export default function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return

    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike })
      .wakeLock
    if (!wakeLock) return

    let torndown = false
    let acquiring = false
    let sentinel: WakeLockSentinelLike | null = null

    // A user agent releases the lock on its own whenever the page hides, and
    // never restores it. Forgetting the sentinel here is what re-opens the
    // re-acquire path below.
    const onSentinelRelease = () => {
      sentinel = null
    }

    const acquire = async () => {
      if (sentinel || acquiring) return
      // request() rejects outright while hidden, so asking is pure noise.
      if (document.visibilityState !== 'visible') return

      acquiring = true
      try {
        const next = await wakeLock.request('screen')
        if (torndown) {
          // The effect was cleaned up while the request was in flight; the
          // cleanup had no handle to release, so it falls to us.
          void next.release().catch(() => {})
          return
        }
        sentinel = next
        next.addEventListener('release', onSentinelRelease)
      } catch {
        // Insecure context, unsupported, blocked by permissions policy, or the
        // page hid mid-flight. Degrade silently to no wake lock.
      } finally {
        acquiring = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      torndown = true
      document.removeEventListener('visibilitychange', onVisibilityChange)

      const held = sentinel
      sentinel = null
      if (held) {
        held.removeEventListener('release', onSentinelRelease)
        void held.release().catch(() => {})
      }
    }
  }, [active])
}
