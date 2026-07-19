import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

beforeEach(() => {
  localStorage.clear()
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
})
