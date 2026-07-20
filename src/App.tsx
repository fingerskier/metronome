import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocalStorage } from 'react-use'
import useBeatScheduler from '@/hook/useBeatScheduler'
import useWakeLock from '@/hook/useWakeLock'
import Blip from '@/com/Blip'

import './App.css'
import logo from './img/logo96.png'


export default function App() {
  const [bpm, setBpm] = useLocalStorage('bpm', 120)
  const [pattern, setPattern] = useLocalStorage('pattern', 4)
  const [sound, setSound] = useLocalStorage('sound', true)
  const [vibe, setVibe] = useLocalStorage('vibe', false)

  const [accent, setAccent] = useState(false)
  const [running, setRunning] = useState(false)
  const [tick, setTick] = useState(false)

  const blipTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Only the visual blip lives here. Vibration is committed ahead of time by
  // the scheduler, on the same grid as the click: this callback runs off the
  // drain rAF, which is parked while the tab is hidden and deliberately
  // collapses a backlog to the most recent beat -- right for the UI, wrong for
  // haptics.
  const onBeat = useCallback((_beat: number, accented: boolean) => {
    setTick(true)
    setAccent(accented)

    clearTimeout(blipTimeout.current)
    blipTimeout.current = setTimeout(() => {
      setTick(false)
    }, 100)
  }, [])

  useBeatScheduler({
    bpm: bpm ?? 120,
    pattern: pattern ?? 4,
    sound: sound ?? true,
    vibe: vibe ?? false,
    running,
    onBeat,
  })

  // A hidden document cannot vibrate at all, and the user agent aborts any
  // running pattern the moment the screen goes off -- so holding the screen
  // awake is what makes pocket use possible. Scoped to vibration rather than
  // to `running`: keeping the screen lit for audio-only practice is a battery
  // cost with nothing to show for it.
  useWakeLock(running && (vibe ?? false))

  useEffect(() => {
    return () => {
      clearTimeout(blipTimeout.current)
    }
  }, [])


  return <>
    <h1>
      <img src={logo} alt="Metronome" className="logo" />
    </h1>

    <div className="row">
      <label htmlFor="bpm"> BPM: </label>

      <input type="number"
        id="bpm"
        value={bpm}
        onChange={(e) => setBpm(Number(e.target.value))}
        min={1}
        max={300}
        step={1}
      />

      <Blip show={tick} accent={accent} />

      <label htmlFor="pattern"> Pattern: </label>

      <select
        id="pattern"
        value={pattern}
        onChange={(e) => setPattern(Number(e.target.value))}
        >
        <option value={2}>2/4</option>
        <option value={3}>3/4</option>
        <option value={4}>4/4</option>
        <option value={6}>6/8</option>
      </select>
    </div>

    <div className="row">
      <label htmlFor="sound">
        Sound
      </label>
      <button id="sound" onClick={() => setSound(!sound)}>
        {sound ? '🔊On' : '🔇Off'}
      </button>
    </div>

    <div className="row">
      <label htmlFor="vibe">
        Vibration
      </label>
      <button id="vibe" onClick={() => setVibe(!vibe)}>
        {vibe ? '📳On' : '📴Off'}
      </button>
    </div>

    {vibe && <p className="hint">
      Keep this page on screen -- vibration stops whenever the page is hidden.
      The screen is held awake while the metronome runs.
    </p>}

    <button onClick={() => setRunning(!running)}>
      {running ? 'Stop' : 'Start'}
    </button>
  </>
}
