import { vi } from 'vitest'

/**
 * jsdom implements neither navigator.wakeLock nor WakeLockSentinel. This stub
 * is drivable: `deferred` holds request() promises open so the teardown race
 * can be tested deterministically, and fireRelease() stands in for the user
 * agent releasing a lock on its own (which it does whenever the page hides).
 */
export class StubWakeLockSentinel {
  type = 'screen'
  released = false
  private listeners: (() => void)[] = []

  release = vi.fn(async () => {
    this.released = true
  })

  addEventListener = vi.fn((type: string, listener: () => void) => {
    if (type === 'release') this.listeners.push(listener)
  })

  removeEventListener = vi.fn((type: string, listener: () => void) => {
    if (type !== 'release') return
    this.listeners = this.listeners.filter((l) => l !== listener)
  })

  /** Test-only: the user agent drops the lock without being asked. */
  fireRelease() {
    this.released = true
    this.listeners.forEach((listener) => listener())
  }
}

export class StubWakeLock {
  sentinels: StubWakeLockSentinel[] = []
  /** When set, request() rejects with this instead of resolving. */
  failure: Error | null = null
  /** When true, request() stays pending until settle() is called. */
  deferred = false

  private waiting: (() => void)[] = []

  request = vi.fn(async (type: string) => {
    if (this.failure) throw this.failure
    const sentinel = new StubWakeLockSentinel()
    sentinel.type = type
    this.sentinels.push(sentinel)
    if (this.deferred) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
    return sentinel
  })

  /** Test-only: let every deferred request() resolve. */
  settle() {
    const waiting = this.waiting
    this.waiting = []
    waiting.forEach((resolve) => resolve())
  }

  get latest(): StubWakeLockSentinel | undefined {
    return this.sentinels.at(-1)
  }
}

export function installWakeLockStub(): StubWakeLock {
  const wakeLock = new StubWakeLock()
  Object.defineProperty(navigator, 'wakeLock', {
    value: wakeLock,
    configurable: true,
    writable: true,
  })
  return wakeLock
}

export function removeWakeLockStub() {
  Reflect.deleteProperty(navigator, 'wakeLock')
}

/** Forces document.visibilityState, which is otherwise read-only in jsdom. */
export function setVisibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(state === 'hidden')
}
