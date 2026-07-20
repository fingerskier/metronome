import { vi } from 'vitest'

/**
 * jsdom provides no Worker, and merely importing a module that constructs one
 * throws `ReferenceError: Worker is not defined` at import time -- which makes
 * an entire test file fail to collect while the run still reports "passed".
 *
 * This stub is drivable: tests call tick() to fire the worker's message
 * handler, standing in for the interval that would run in a real worker.
 */
export class StubWorker {
  static instances: StubWorker[] = []

  url: string | URL
  options: WorkerOptions | undefined
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  posted: unknown[] = []

  postMessage = vi.fn((message: unknown) => {
    this.posted.push(message)
  })

  terminate = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  dispatchEvent = vi.fn(() => true)

  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url
    this.options = options
    StubWorker.instances.push(this)
  }

  /** Test-only: fire one scheduler tick. */
  tick() {
    this.onmessage?.({ data: 'tick' } as MessageEvent)
  }
}

/** The worker most recently constructed by the code under test. */
export function latestWorker(): StubWorker {
  const worker = StubWorker.instances.at(-1)
  if (!worker) throw new Error('no Worker was constructed')
  return worker
}

/** Installs the stub globally and clears previously recorded instances. */
export function installWorkerStub() {
  StubWorker.instances = []
  Object.defineProperty(globalThis, 'Worker', {
    value: StubWorker,
    configurable: true,
    writable: true,
  })
}
