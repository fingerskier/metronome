import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { latestAudioContext } from './test/audioStub'
import { latestWorker } from './test/workerStub'
import {
  installVibrateStub,
  issuedPatterns,
  removeVibrateStub,
} from './test/vibrateStub'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  removeVibrateStub()
})

describe('App', () => {
  it('starts at 120bpm in 4/4', () => {
    render(<App />)

    expect(screen.getByLabelText(/bpm/i)).toHaveProperty('value', '120')
    expect(screen.getByLabelText(/pattern/i)).toHaveProperty('value', '4')
  })

  it('persists a tempo change to localStorage', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/bpm/i), { target: { value: '90' } })

    expect(screen.getByLabelText(/bpm/i)).toHaveProperty('value', '90')
    expect(localStorage.getItem('bpm')).toBe('90')
  })

  it('persists a pattern change to localStorage', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText(/pattern/i), { target: { value: '3' } })

    expect(localStorage.getItem('pattern')).toBe('3')
  })

  it('rehydrates saved settings on mount', () => {
    localStorage.setItem('bpm', '160')
    localStorage.setItem('pattern', '6')

    render(<App />)

    expect(screen.getByLabelText(/bpm/i)).toHaveProperty('value', '160')
    expect(screen.getByLabelText(/pattern/i)).toHaveProperty('value', '6')
  })

  it('has sound on and vibration off by default', () => {
    render(<App />)

    expect(screen.getByLabelText(/sound/i).textContent).toContain('On')
    expect(screen.getByLabelText(/vibration/i).textContent).toContain('Off')
  })

  it('toggles sound off and remembers it', () => {
    render(<App />)
    const sound = screen.getByLabelText(/sound/i)

    fireEvent.click(sound)

    expect(sound.textContent).toContain('Off')
    expect(localStorage.getItem('sound')).toBe('false')
  })

  it('toggles vibration on and remembers it', () => {
    render(<App />)
    const vibe = screen.getByLabelText(/vibration/i)

    fireEvent.click(vibe)

    expect(vibe.textContent).toContain('On')
    expect(localStorage.getItem('vibe')).toBe('true')
  })

  it('flips the transport button between Start and Stop', () => {
    render(<App />)
    const transport = screen.getByRole('button', { name: 'Start' })

    fireEvent.click(transport)

    expect(screen.getByRole('button', { name: 'Stop' })).toBe(transport)
  })

  describe('onBeat wiring', () => {
    // Real ticks are needed here -- driving a beat means advancing the
    // scheduler's audio clock and letting its rAF drain fire, same as
    // useBeatScheduler.test.ts. Scoped to this describe so the other tests
    // above, which never touch the clock, are unaffected.
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('drives the blip from onBeat', async () => {
      render(<App />)

      fireEvent.click(screen.getByRole('button', { name: 'Start' }))
      // begin() awaits resumeAudio() before committing anything; an async
      // act() is required to flush that microtask before anything is
      // scheduled. See useBeatScheduler.test.ts's mount() helper.
      await act(async () => {})

      const ctx = latestAudioContext()
      const worker = latestWorker()

      // The first beat (an accented downbeat, per useBeatScheduler's
      // contract) was already committed synchronously inside begin(). Move
      // the audio clock past it and let the drain rAF notice.
      act(() => {
        ctx.currentTime = 0.1
        vi.advanceTimersByTime(20)
      })

      expect(screen.getByText('🟢')).toBeDefined()

      // 120bpm default -> 0.5s spacing, an unaccented offbeat.
      act(() => {
        ctx.currentTime = 0.5
        worker.tick()
      })
      act(() => {
        ctx.currentTime = 0.6
        vi.advanceTimersByTime(20)
      })

      expect(screen.getByText('⚪')).toBeDefined()
    })

    it('hands the vibration toggle to the scheduler, taking effect on the next pass', async () => {
      // Vibration is committed ahead of time by the scheduler rather than
      // fired from onBeat, so what App owes it is the live value of the
      // toggle: flipping it while running must reach the very next scheduling
      // pass, not be stuck at whatever it was when the effect was created.
      const vibrate = installVibrateStub()
      render(<App />)

      fireEvent.click(screen.getByRole('button', { name: 'Start' }))
      await act(async () => {})

      const ctx = latestAudioContext()
      const worker = latestWorker()

      act(() => {
        ctx.currentTime = 0.1
        worker.tick()
      })
      expect(vibrate).not.toHaveBeenCalled()

      fireEvent.click(screen.getByLabelText(/vibration/i))

      act(() => {
        ctx.currentTime = 0.2
        worker.tick()
      })

      // One whole run of beats, handed over as a single pattern.
      const patterns = issuedPatterns(vibrate)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].length).toBeGreaterThan(2)
    })

    it('warns that vibration stops while the page is hidden, only when it is on', async () => {
      // The batch runs in the OS vibrator service, but the user agent still
      // aborts it on any visibility change -- so this is a limitation to state
      // plainly rather than paper over.
      render(<App />)
      expect(screen.queryByText(/vibration stops/i)).toBeNull()

      fireEvent.click(screen.getByLabelText(/vibration/i))

      expect(screen.getByText(/vibration stops/i)).toBeDefined()
    })
  })
})
