import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import useBeep from './useBeep'
import { latestAudioContext } from '../test/audioStub'

describe('useBeep', () => {
  it('plays a 440Hz sine at half gain on an offbeat', () => {
    const { result } = renderHook(() => useBeep())

    act(() => result.current.beep(false))

    const ctx = latestAudioContext()
    const osc = ctx.oscillators.at(-1)!
    expect(osc.type).toBe('sine')
    expect(osc.frequency.value).toBe(440)
    expect(osc.start).toHaveBeenCalled()
    // The master gain is built at mount, so the note's own gain is the newest.
    expect(ctx.gains.at(-1)!.gain.value).toBe(0.5)
  })

  it('accents an octave up at full gain', () => {
    const { result } = renderHook(() => useBeep())

    act(() => result.current.beep(true))

    const ctx = latestAudioContext()
    expect(ctx.oscillators.at(-1)!.frequency.value).toBe(880)
    expect(ctx.gains.at(-1)!.gain.value).toBe(1)
  })

  it('ramps each note down and stops it so notes do not overlap', () => {
    const { result } = renderHook(() => useBeep())

    act(() => result.current.beep())

    const ctx = latestAudioContext()
    expect(ctx.gains.at(-1)!.gain.exponentialRampToValueAtTime).toHaveBeenCalled()
    expect(ctx.oscillators.at(-1)!.stop).toHaveBeenCalled()
  })

  it('builds one oscillator per beat', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.beep(true)
      result.current.beep(false)
      result.current.beep(false)
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
