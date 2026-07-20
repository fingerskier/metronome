import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useBeatScheduler from './useBeatScheduler'
import { latestAudioContext } from '../test/audioStub'
import { latestWorker } from '../test/workerStub'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

type Options = Parameters<typeof useBeatScheduler>[0]

// MUST be awaited. The hook awaits resumeAudio() before it schedules anything,
// so the first beats are committed on a microtask. `vi.advanceTimersByTime(0)`
// does NOT flush microtasks -- only an async act() does. Getting this wrong
// makes every scheduling assertion race the scheduler and fail intermittently.
async function mount(overrides: Partial<Options> = {}) {
  const onBeat = vi.fn()
  const props: Options = {
    bpm: 120,
    pattern: 4,
    sound: true,
    running: true,
    onBeat,
    ...overrides,
  }
  const view = renderHook((p: Options) => useBeatScheduler(p), {
    initialProps: props,
  })
  await act(async () => {})
  return { ...view, onBeat }
}

/** Audio-clock times passed to osc.start(), in scheduling order. */
function scheduledTimes(): number[] {
  return latestAudioContext().oscillators.map(
    (osc) => osc.start.mock.calls[0][0] as number,
  )
}

describe('useBeatScheduler', () => {
  it('starts the worker heartbeat when running', async () => {
    await mount()

    expect(latestWorker().posted).toContainEqual({
      type: 'start',
      interval: 25,
    })
  })

  it('schedules beats exactly 60/bpm apart on the audio clock', async () => {
    // 132bpm = 0.4545...s per beat, deliberately not a round number.
    await mount({ bpm: 132 })
    const ctx = latestAudioContext()

    // Walk the audio clock forward, ticking as a real worker would.
    for (let i = 1; i <= 20; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    const times = scheduledTimes()
    expect(times.length).toBeGreaterThan(8)

    const expected = 60 / 132
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeCloseTo(expected, 9)
    }
  })

  it('accents the first beat of a run and every pattern-th beat after', async () => {
    await mount({ bpm: 240, pattern: 4 })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 12; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    // 880Hz marks an accent, 440Hz an offbeat.
    const freqs = ctx.oscillators.map((osc) => osc.frequency.value)
    expect(freqs.length).toBeGreaterThanOrEqual(8)
    freqs.slice(0, 8).forEach((f, i) => {
      expect(f).toBe(i % 4 === 0 ? 880 : 440)
    })
  })

  it('follows the pattern length for accent placement', async () => {
    await mount({ bpm: 240, pattern: 3 })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 12; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    const freqs = ctx.oscillators.map((osc) => osc.frequency.value)
    freqs.slice(0, 6).forEach((f, i) => {
      expect(f).toBe(i % 3 === 0 ? 880 : 440)
    })
  })

  it('schedules no audio when sound is muted', async () => {
    await mount({ sound: false })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 8; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    expect(ctx.oscillators).toHaveLength(0)
  })

  it('picks up a tempo change on the next scheduled beat', async () => {
    const { rerender, onBeat } = await mount({ bpm: 120 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 0.5
      latestWorker().tick()
    })
    const before = scheduledTimes().length

    rerender({ bpm: 240, pattern: 4, sound: true, running: true, onBeat })

    act(() => {
      ctx.currentTime = 2
      latestWorker().tick()
    })

    const times = scheduledTimes()
    const gap = times[times.length - 1] - times[times.length - 2]
    expect(before).toBeGreaterThan(0)
    expect(gap).toBeCloseTo(60 / 240, 9)
  })

  it('does not schedule anything while stopped', async () => {
    await mount({ running: false })

    expect(latestAudioContext().oscillators).toHaveLength(0)
  })

  it('tells the worker to stop and terminates it', async () => {
    const { rerender, onBeat } = await mount()
    const worker = latestWorker()

    rerender({ bpm: 120, pattern: 4, sound: true, running: false, onBeat })

    expect(worker.posted).toContainEqual({ type: 'stop' })
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('restarts from an accented downbeat after stop', async () => {
    const { rerender, onBeat } = await mount({ bpm: 240, pattern: 4 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 0.5
      latestWorker().tick()
    })

    rerender({ bpm: 240, pattern: 4, sound: true, running: false, onBeat })

    const beforeRestart = ctx.oscillators.length
    rerender({ bpm: 240, pattern: 4, sound: true, running: true, onBeat })
    await act(async () => {})

    const firstAfterRestart = ctx.oscillators[beforeRestart]
    expect(firstAfterRestart.frequency.value).toBe(880)
  })
})
