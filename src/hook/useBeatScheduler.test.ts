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

  it('falls back to a safe tempo instead of hanging when bpm is negative', async () => {
    // `||` guards truthiness, not positivity. A negative bpm is truthy, so an
    // unguarded fallback computes secondsPerBeat = 60 / -5 = -12: the
    // while-loop in scheduleAhead then walks nextNoteTime AWAY from its
    // horizon forever. That loop runs synchronously (once during mount's
    // begin(), and again on every worker tick), so a regression here hangs
    // this test until the per-test timeout fires rather than failing cleanly.
    await mount({ bpm: -5 })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 20; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    const times = scheduledTimes()
    expect(times.length).toBeGreaterThan(4)

    // A non-positive bpm must fall back to the same default tempo used
    // elsewhere in this file (120bpm), not to a negative or zero spacing.
    const expected = 60 / 120
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeCloseTo(expected, 9)
    }
  })

  it('falls back to a safe tempo instead of hanging when bpm is Infinity', async () => {
    // Typing "1e400" into a number input parses to Infinity -- min/max on a
    // number input are advisory and do not clamp typed values. An unguarded
    // fallback computes secondsPerBeat = 60 / Infinity = 0: nextNoteTime never
    // advances, so the while-loop in scheduleAhead never reaches its horizon
    // and hangs the tab (and, since sound defaults true, allocates oscillators
    // until the process runs out of memory).
    await mount({ bpm: Infinity })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 20; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    const times = scheduledTimes()
    expect(times.length).toBeGreaterThan(4)

    // A non-finite bpm must fall back to the same default tempo used
    // elsewhere in this file (120bpm), not to a zero or vanishing spacing.
    const expected = 60 / 120
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeCloseTo(expected, 9)
    }
  })

  it('clamps an astronomically large finite bpm to a sane tempo', async () => {
    // A huge but finite bpm passes a bare `> 0` check and produces a
    // secondsPerBeat so small the loop would need astronomically many
    // iterations to reach its horizon -- a hang in practice, and (since sound
    // defaults true) an oscillator-allocating one. The fix must clamp bpm to
    // MAX_BPM rather than merely rejecting non-finite values.
    await mount({ bpm: 1e18 })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 20; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    const times = scheduledTimes()
    expect(times.length).toBeGreaterThan(4)

    // Every gap must be a sane, strictly positive spacing matching the
    // MAX_BPM clamp (60/1000s) -- not the vanishingly small (effectively
    // zero) gap an unclamped 1e18bpm implies.
    const expected = 60 / 1000
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1]
      expect(gap).toBeGreaterThan(0)
      expect(gap).toBeCloseTo(expected, 9)
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

  it('recovers a coherent accent cycle when pattern floors to zero', async () => {
    // The guard must floor BEFORE checking positivity. Math.floor(0.5) is 0,
    // and (beat + 1) % 0 is NaN. `beat` is a closure variable that persists
    // across scheduleAhead calls (it is never reset by ticks), so a single
    // NaN permanently kills the accent -- beat === 0 never holds again for
    // the life of the effect, instead of falling back to the default
    // pattern like other invalid inputs do.
    await mount({ bpm: 240, pattern: 0.5 })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 12; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    // A pattern that floors to zero must fall back to the same default
    // pattern (4) used elsewhere in this file, not corrupt the accent cycle
    // with NaN. If it corrupted, every beat after the first would read as
    // an offbeat (440Hz) forever instead of recurring every 4th beat.
    const freqs = ctx.oscillators.map((osc) => osc.frequency.value)
    expect(freqs.length).toBeGreaterThanOrEqual(8)
    freqs.slice(0, 8).forEach((f, i) => {
      expect(f).toBe(i % 4 === 0 ? 880 : 440)
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

  it('keeps the beat phase advancing while muted, so unmuting lands mid-pattern', async () => {
    // Muting must silence the click without pausing the beat: phase keeps
    // advancing so that unmuting lands on the correct beat and accent,
    // rather than resuming (or restarting) on a downbeat.
    const { rerender, onBeat } = await mount({
      bpm: 240,
      pattern: 4,
      sound: false,
    })
    const ctx = latestAudioContext()

    // Drive just over three full pattern cycles (13 beats total, including
    // the one scheduled synchronously at mount) while muted.
    for (let i = 1; i <= 12; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }
    expect(ctx.oscillators).toHaveLength(0) // still silent throughout

    rerender({ bpm: 240, pattern: 4, sound: true, running: true, onBeat })

    for (let i = 13; i <= 16; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    const freqs = ctx.oscillators.map((osc) => osc.frequency.value)
    // The muted phase above ends mid-pattern, one beat past a downbeat. If
    // muting had paused (or reset) the phase, the first audible beat here
    // would be an accented downbeat (880Hz) instead of the offbeat the
    // continued phase predicts.
    expect(freqs).toEqual([440, 440, 440, 880])
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

  it('cancels beats already scheduled into the future when stopped', async () => {
    const { rerender, onBeat } = await mount({ bpm: 60 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 1
      latestWorker().tick()
    })

    const committed = ctx.oscillators.length
    expect(committed).toBeGreaterThan(0)

    rerender({ bpm: 60, pattern: 4, sound: true, running: false, onBeat })

    // Every note the scheduler committed to must be actively cancelled --
    // otherwise it still sounds after Stop.
    ctx.oscillators.forEach((osc) => {
      expect(osc.stop).toHaveBeenCalledWith()
      expect(osc.disconnect).toHaveBeenCalled()
    })
  })

  it('reports a beat to the UI once its audio time has arrived', async () => {
    const { onBeat } = await mount({ bpm: 120, pattern: 4 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 0.2
      latestWorker().tick()
      vi.advanceTimersByTime(50)
    })

    expect(onBeat).toHaveBeenCalled()
    const [beat, accent] = onBeat.mock.calls[0]
    expect(beat).toBe(0)
    expect(accent).toBe(true)
  })

  it('does not report a beat before its audio time', async () => {
    const { onBeat } = await mount({ bpm: 60 })

    // currentTime stays at 0; the first beat is scheduled at START_OFFSET.
    act(() => {
      latestWorker().tick()
      vi.advanceTimersByTime(50)
    })

    expect(onBeat).not.toHaveBeenCalled()
  })

  it('releases notes that have finished sounding', async () => {
    // Guards against the committed-notes array growing for the whole run.
    // The array is private, but pruning is observable: a note already
    // finished must NOT be re-cancelled on stop, while a pending one must be.
    const { rerender, onBeat } = await mount({ bpm: 240, pattern: 4 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 0.5
      latestWorker().tick()
    })

    const early = ctx.oscillators[0]
    expect(early).toBeDefined()

    // Advance past the first note's end and run a frame so the drain prunes.
    act(() => {
      ctx.currentTime = 5
      vi.advanceTimersByTime(20)
    })

    // Commit a fresh note that is still in the future, then stop.
    act(() => {
      latestWorker().tick()
    })
    const pending = ctx.oscillators[ctx.oscillators.length - 1]

    rerender({ bpm: 240, pattern: 4, sound: true, running: false, onBeat })

    expect(early.stop).not.toHaveBeenCalledWith()
    expect(pending.stop).toHaveBeenCalledWith()
  })

  it('drops stale beats instead of firing a burst after a hidden stretch', async () => {
    const { onBeat } = await mount({ bpm: 240, pattern: 4 })
    const ctx = latestAudioContext()

    // Build a REAL backlog. Ticking the worker commits beats, but the drain
    // only runs when timers advance -- so ticking without advancing lets the
    // queue accumulate exactly as it does while the tab is hidden and rAF is
    // parked. A single tick would queue one beat and prove nothing: the test
    // must be able to fail if the drain fires every due entry instead of the
    // last one.
    for (let i = 1; i <= 12; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }
    expect(onBeat).not.toHaveBeenCalled()

    // Jump the audio clock past every queued beat, then run a single frame.
    act(() => {
      ctx.currentTime = 30
      vi.advanceTimersByTime(20)
    })

    // A dozen beats are due at once. Replaying them would machine-gun the UI.
    expect(onBeat.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('commits far more beats ahead while the tab is hidden', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)

    const { onBeat } = await mount({ bpm: 120 })
    expect(onBeat).not.toHaveBeenCalled()

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      latestWorker().tick()
    })

    // A 2s lookahead at 120bpm is about four beats; a 0.1s one is a single beat.
    expect(latestAudioContext().oscillators.length).toBeGreaterThanOrEqual(4)
    hidden.mockRestore()
  })

  it('commits only the next beat or so while visible', async () => {
    await mount({ bpm: 120 })

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      latestWorker().tick()
    })

    expect(latestAudioContext().oscillators.length).toBeLessThanOrEqual(2)
  })

  it('widens the lookahead from a live visibilitychange event, not just at mount', async () => {
    // The two tests above only ever exercise sync()'s mount-time call: they
    // mock document.hidden BEFORE mounting, so the horizon is already right
    // by the time anything is scheduled, and the dispatchEvent in each proves
    // nothing (hidden doesn't change, so sync() is a no-op both times it
    // runs). This test mounts VISIBLE, drives real scheduling passes, and
    // only THEN flips hidden and dispatches -- so the widened horizon can
    // only be explained by the addEventListener('visibilitychange', sync)
    // registration actually firing sync() again.
    const { onBeat } = await mount({ bpm: 120 })
    const ctx = latestAudioContext()
    expect(onBeat).not.toHaveBeenCalled()

    // bpm 120 -> secondsPerBeat = 60/120 = 0.5s exactly.
    // Mount already ran one scheduling pass: nextNoteTime = audioTime()(0) +
    // START_OFFSET(0.05) = 0.05; horizon = 0 + LOOKAHEAD_VISIBLE(0.1) = 0.1;
    // 0.05 < 0.1 commits one note and advances nextNoteTime to 0.55.
    expect(ctx.oscillators).toHaveLength(1)

    act(() => {
      ctx.currentTime = 0.5
      latestWorker().tick()
    })
    // horizon = 0.5 + 0.1 = 0.6; nextNoteTime(0.55) < 0.6 commits and
    // advances to 1.05.

    act(() => {
      ctx.currentTime = 1.0
      latestWorker().tick()
    })
    // horizon = 1.0 + 0.1 = 1.1; nextNoteTime(1.05) < 1.1 commits and
    // advances to 1.55. Three notes committed so far under the visible
    // lookahead, one per pass -- this is the "small number" the 0.1s horizon
    // can ever expose at this tick spacing.
    const visibleCount = ctx.oscillators.length
    expect(visibleCount).toBe(3)

    // Only NOW does hidden change, live, while the scheduler is running.
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // Drive one more pass at the SAME audio time (currentTime still 1.0) --
    // isolating the widened horizon to the event, not to clock advancement.
    // Had the listener not fired, lookaheadRef would still hold
    // LOOKAHEAD_VISIBLE, so horizon would still be 1.0 + 0.1 = 1.1 -- already
    // behind nextNoteTime (1.55), so the while-loop's condition would be
    // false on entry and this pass would commit ZERO new oscillators.
    // Because the listener honors the event, lookaheadRef becomes
    // LOOKAHEAD_HIDDEN(2), so horizon = 1.0 + 2 = 3.0, and three more notes
    // fall inside [1.55, 3.0): 1.55, 2.05, 2.55 (each 0.5s apart; the next,
    // 3.05, misses the horizon).
    act(() => {
      latestWorker().tick()
    })

    expect(ctx.oscillators.length).toBe(visibleCount + 3)
    hidden.mockRestore()
  })
})
