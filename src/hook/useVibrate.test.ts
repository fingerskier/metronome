import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import useVibrate from './useVibrate'
import { installVibrateStub, removeVibrateStub } from '../test/vibrateStub'

afterEach(() => {
  removeVibrateStub()
})

describe('useVibrate', () => {
  it('hands the pattern it is given to the Vibration API', () => {
    const vibrate = installVibrateStub()
    const { result } = renderHook(() => useVibrate())

    result.current.vibrateBatch([0, 50, 120, 40, 80])

    expect(vibrate).toHaveBeenCalledWith([0, 50, 120, 40, 80])
  })

  it('reports success when the user agent accepts the pattern', () => {
    installVibrateStub(() => true)
    const { result } = renderHook(() => useVibrate())

    expect(result.current.vibrateBatch([70])).toBe(true)
  })

  it('reports failure when the user agent refuses the pattern', () => {
    // The documented refusal path: a hidden document, no vibration hardware,
    // or a permissions policy. The scheduler leans on this return value to
    // know it must retry rather than assume the beats are covered.
    installVibrateStub(() => false)
    const { result } = renderHook(() => useVibrate())

    expect(result.current.vibrateBatch([70])).toBe(false)
  })

  it('treats an undefined return as success', () => {
    // Some user agents return undefined rather than the spec's boolean.
    installVibrateStub(() => undefined)
    const { result } = renderHook(() => useVibrate())

    expect(result.current.vibrateBatch([70])).toBe(true)
  })

  it('returns false without throwing where the Vibration API is unavailable', () => {
    // No stub installed -- desktop Safari, and every desktop browser.
    const { result } = renderHook(() => useVibrate())

    expect(result.current.vibrateBatch([70])).toBe(false)
  })

  it('returns false for an empty pattern without calling the API', () => {
    const vibrate = installVibrateStub()
    const { result } = renderHook(() => useVibrate())

    expect(result.current.vibrateBatch([])).toBe(false)
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('cancels a running pattern by passing zero', () => {
    const vibrate = installVibrateStub()
    const { result } = renderHook(() => useVibrate())

    result.current.cancelVibration()

    expect(vibrate).toHaveBeenCalledWith(0)
  })

  it('cancels without throwing where the Vibration API is unavailable', () => {
    const { result } = renderHook(() => useVibrate())

    expect(() => result.current.cancelVibration()).not.toThrow()
  })

  it('keeps both callbacks stable across renders', () => {
    // The scheduler effect lists these in its dependency array; a fresh
    // identity per render would tear down and restart the whole transport.
    installVibrateStub()
    const { result, rerender } = renderHook(() => useVibrate())
    const first = result.current

    rerender()

    expect(result.current.vibrateBatch).toBe(first.vibrateBatch)
    expect(result.current.cancelVibration).toBe(first.cancelVibration)
  })
})
