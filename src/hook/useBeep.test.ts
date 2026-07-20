import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import useBeep from './useBeep'
import { latestAudioContext } from '../test/audioStub'

describe('useBeep', () => {
  it('starts and stops the note at the requested audio time', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(1.25, false)
    })

    const osc = latestAudioContext().oscillators.at(-1)!
    expect(osc.start).toHaveBeenCalledWith(1.25)
    expect(osc.stop).toHaveBeenCalledWith(1.25 + 0.1)
  })

  it('plays a 440Hz sine at half gain on an offbeat', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(0.5, false)
    })

    const ctx = latestAudioContext()
    const osc = ctx.oscillators.at(-1)!
    expect(osc.type).toBe('sine')
    expect(osc.frequency.value).toBe(440)
    expect(ctx.gains.at(-1)!.gain.value).toBe(0.5)
  })

  it('accents an octave up at full gain', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(0.5, true)
    })

    const ctx = latestAudioContext()
    expect(ctx.oscillators.at(-1)!.frequency.value).toBe(880)
    expect(ctx.gains.at(-1)!.gain.value).toBe(1)
  })

  it('ramps the note down relative to its own start time', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(2, false)
    })

    const ctx = latestAudioContext()
    expect(
      ctx.gains.at(-1)!.gain.exponentialRampToValueAtTime,
    ).toHaveBeenCalledWith(0.0001, 2.1)
  })

  it('returns the oscillator so the caller can cancel it', () => {
    const { result } = renderHook(() => useBeep())

    let returned: unknown
    act(() => {
      returned = result.current.scheduleBeep(0.5, false)
    })

    expect(returned).toBe(latestAudioContext().oscillators.at(-1))
  })

  it('reports the current audio clock time', () => {
    const { result } = renderHook(() => useBeep())
    latestAudioContext().currentTime = 3.5

    expect(result.current.audioTime()).toBe(3.5)
  })

  it('builds one oscillator per scheduled beat', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(0.1, true)
      result.current.scheduleBeep(0.6, false)
      result.current.scheduleBeep(1.1, false)
    })

    expect(latestAudioContext().oscillators).toHaveLength(3)
  })

  it('resumes a context the browser suspended until first gesture', async () => {
    const { result } = renderHook(() => useBeep())
    const ctx = latestAudioContext()
    ctx.state = 'suspended'

    await act(async () => {
      await result.current.resumeAudio()
    })

    expect(ctx.resume).toHaveBeenCalled()
    expect(ctx.state).toBe('running')
  })

  it('leaves an already-running context alone', async () => {
    const { result } = renderHook(() => useBeep())
    const ctx = latestAudioContext()

    await act(async () => {
      await result.current.resumeAudio()
    })

    expect(ctx.resume).not.toHaveBeenCalled()
  })

  it('closes the context on unmount', () => {
    const { unmount } = renderHook(() => useBeep())
    const ctx = latestAudioContext()

    unmount()

    expect(ctx.close).toHaveBeenCalled()
  })
})
