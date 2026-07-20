import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useTimer from './useTimer'

// useTimer drives itself off requestAnimationFrame + Date.now(), both of which
// vitest's fake timers replace. Frames advance in 16ms steps, so a tick lands
// on the first frame at or past the duration -- not exactly on it.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTimer', () => {
  it('stays idle until started', () => {
    const tick = vi.fn()
    renderHook(() => useTimer(tick, 100))

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(tick).not.toHaveBeenCalled()
  })

  it('does not fire before a full duration has elapsed', () => {
    const tick = vi.fn()
    const { result } = renderHook(() => useTimer(tick, 100))

    act(() => result.current.start())
    act(() => {
      vi.advanceTimersByTime(90)
    })

    expect(tick).not.toHaveBeenCalled()
  })

  it('fires once the duration has elapsed', () => {
    const tick = vi.fn()
    const { result } = renderHook(() => useTimer(tick, 100))

    act(() => result.current.start())
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('keeps firing at roughly the requested tempo', () => {
    const tick = vi.fn()
    const { result } = renderHook(() => useTimer(tick, 100))

    act(() => result.current.start())
    act(() => {
      vi.advanceTimersByTime(1000)
    })

    // A correct timer fires 9 or 10 times here: beats are spaced a true 100ms
    // apart, but the first one waits for a frame boundary, so the tenth can
    // fall just past the window. 8 would mean the tempo itself is running slow
    // -- that was the pre-fix behaviour. Average tempo is asserted separately.
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(9)
    expect(tick.mock.calls.length).toBeLessThanOrEqual(10)
  })

  it('holds the requested tempo on average when the beat is not a whole number of frames', () => {
    // 132bpm = 454.5ms per beat, deliberately NOT a multiple of the frame
    // period. This is the case where discarding the per-beat overshoot instead
    // of carrying it shows up as a systematically slow tempo.
    const duration = 60000 / 132
    const fires: number[] = []
    const { result } = renderHook(() =>
      useTimer(() => {
        fires.push(Date.now())
      }, duration),
    )

    act(() => result.current.start())
    act(() => {
      vi.advanceTimersByTime(duration * 40)
    })

    expect(fires.length).toBeGreaterThan(30)

    const meanPeriod = (fires[fires.length - 1] - fires[0]) / (fires.length - 1)
    // Within 1%. Musicians resolve tempo differences well below this.
    expect(meanPeriod).toBeGreaterThan(duration * 0.99)
    expect(meanPeriod).toBeLessThan(duration * 1.01)
  })

  it('does not fire a burst of catch-up beats after the loop was stalled', () => {
    // Guards the residual-carry logic: a backgrounded tab throttles or pauses
    // rAF, so the clock can jump far ahead of the last beat. The timer must
    // resync rather than machine-gun one beat per frame until it catches up.
    const tick = vi.fn()
    const { result } = renderHook(() => useTimer(tick, 100))

    act(() => result.current.start())
    act(() => {
      vi.advanceTimersByTime(500)
    })
    const beforeStall = tick.mock.calls.length

    // Jump the clock without running any frames -- that is what a stall is.
    act(() => {
      vi.setSystemTime(Date.now() + 10000)
      vi.advanceTimersByTime(32)
    })

    // 10s at 100ms would be 100 beats if it tried to catch up.
    expect(tick.mock.calls.length - beforeStall).toBeLessThanOrEqual(2)
  })

  it('reports the elapsed delta to the callback', () => {
    const tick = vi.fn()
    const { result } = renderHook(() => useTimer(tick, 100))

    act(() => result.current.start())
    act(() => {
      vi.advanceTimersByTime(200)
    })

    const [delta] = tick.mock.calls[0]
    expect(delta).toBeGreaterThanOrEqual(100)
  })

  it('stops firing after stop()', () => {
    const tick = vi.fn()
    const { result } = renderHook(() => useTimer(tick, 100))

    act(() => result.current.start())
    act(() => {
      vi.advanceTimersByTime(200)
    })
    const afterStart = tick.mock.calls.length

    act(() => result.current.stop())
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(tick.mock.calls.length).toBe(afterStart)
  })

  it('tracks running state', () => {
    const { result } = renderHook(() => useTimer(vi.fn(), 100))

    expect(result.current.running).toBe(false)
    act(() => result.current.start())
    expect(result.current.running).toBe(true)
    act(() => result.current.stop())
    expect(result.current.running).toBe(false)
  })

  it('slows down when the duration is raised', () => {
    const tick = vi.fn()
    const { result } = renderHook(() => useTimer(tick, 100))

    act(() => result.current.start())
    act(() => result.current.setDuration(1000))
    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(tick).not.toHaveBeenCalled()
  })

  it('uses the latest callback without restarting the loop', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(
      ({ cb }) => useTimer(cb, 100),
      { initialProps: { cb: first } },
    )

    act(() => result.current.start())
    rerender({ cb: second })
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })

  it('cancels its frame on unmount', () => {
    const tick = vi.fn()
    const { result, unmount } = renderHook(() => useTimer(tick, 100))

    act(() => result.current.start())
    unmount()
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(tick).not.toHaveBeenCalled()
  })
})
