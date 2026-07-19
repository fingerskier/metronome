import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useVibrate from './useVibrate'

function stubVibrate(impl: (pattern: number) => boolean = () => true) {
  const vibrate = vi.fn(impl)
  Object.defineProperty(navigator, 'vibrate', {
    value: vibrate,
    configurable: true,
    writable: true,
  })
  return vibrate
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'vibrate')
})

describe('useVibrate', () => {
  it('buzzes briefly on an offbeat', () => {
    const vibrate = stubVibrate()
    const { result } = renderHook(() => useVibrate())

    result.current(false)

    expect(vibrate).toHaveBeenCalledWith(20)
  })

  it('buzzes longer on an accented beat', () => {
    const vibrate = stubVibrate()
    const { result } = renderHook(() => useVibrate())

    result.current(true)

    expect(vibrate).toHaveBeenCalledWith(50)
  })

  it('treats a missing argument as an offbeat', () => {
    const vibrate = stubVibrate()
    const { result } = renderHook(() => useVibrate())

    result.current()

    expect(vibrate).toHaveBeenCalledWith(20)
  })

  it('is a no-op where the Vibration API is unavailable', () => {
    // navigator.vibrate is deliberately not installed here -- desktop Safari
    // and most desktop browsers have no Vibration API at all.
    const { result } = renderHook(() => useVibrate())

    expect(() => result.current(true)).not.toThrow()
  })
})
