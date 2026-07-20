import { vi } from 'vitest'

/**
 * jsdom ships no Web Audio implementation, so `new AudioContext()` throws.
 * These stubs are just enough for useBeep: a context that hands out gain and
 * oscillator nodes and records what was done to them.
 */
export class StubAudioParam {
  value = 0
  exponentialRampToValueAtTime = vi.fn()
}

export class StubOscillator {
  type = ''
  frequency = new StubAudioParam()
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}

export class StubGain {
  gain = new StubAudioParam()
  connect = vi.fn()
}

export class StubAudioContext {
  /** Every context built since the last installAudioStub(), oldest first. */
  static instances: StubAudioContext[] = []

  state: AudioContextState = 'running'
  currentTime = 0
  destination = {}
  oscillators: StubOscillator[] = []
  gains: StubGain[] = []

  constructor() {
    StubAudioContext.instances.push(this)
  }

  createGain = vi.fn(() => {
    const gain = new StubGain()
    this.gains.push(gain)
    return gain
  })

  createOscillator = vi.fn(() => {
    const osc = new StubOscillator()
    this.oscillators.push(osc)
    return osc
  })

  resume = vi.fn(async () => {
    this.state = 'running'
  })

  close = vi.fn()
}

/** The context most recently constructed by the code under test. */
export function latestAudioContext(): StubAudioContext {
  const ctx = StubAudioContext.instances.at(-1)
  if (!ctx) throw new Error('no AudioContext was constructed')
  return ctx
}

/** Installs the stub on window and clears any previously recorded instances. */
export function installAudioStub() {
  StubAudioContext.instances = []
  Object.defineProperty(window, 'AudioContext', {
    value: StubAudioContext,
    configurable: true,
    writable: true,
  })
}
