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

    // A perfect timer would fire 10 times in a second. Frame quantisation makes
    // each interval land a little late, so allow a small shortfall.
    expect(tick.mock.calls.length).toBeGreaterThanOrEqual(8)
    expect(tick.mock.calls.length).toBeLessThanOrEqual(10)
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
