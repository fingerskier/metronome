import { useEffect, useRef, useState } from 'react'
import { useLocalStorage } from 'react-confection'
import useTimer from './hooks/useTimer'
import useBeep from './hooks/useBeep'
import useVibrate from './hooks/useVibrate'

import './App.css'


function App() {
  const [bpm, setBpm] = useLocalStorage('bpm', 120)
  const [pattern, setPattern] = useLocalStorage('pattern', 4)
  const [sound, setSound] = useLocalStorage('sound', true)
  const [vibe, setVibe] = useLocalStorage('vibe', false)

  const [running, setRunning] = useState(false)

  const beep = useBeep()
  const vibrate = useVibrate()
  const beatRef = useRef(0)
  const { start, stop, setDuration } = useTimer(() => {
    beatRef.current = (beatRef.current + 1) % pattern
    const accent = beatRef.current === 0
    if (sound) beep(accent)
    if (vibe) vibrate(accent)
  }, 60000 / bpm)

  useEffect(() => {
    setDuration(60000 / bpm)
  }, [bpm, setDuration])

  useEffect(() => {
    if (running) start()
    else stop()
  }, [running, start, stop])


  return <>
    <h1>Metronome</h1>

    <label>
      BPM:
      <input type="number" 
        value={bpm} 
        onChange={(e) => setBpm(Number(e.target.value))} 
        min={1}
        max={300}
        step={1}
      />
    </label>

    <label>
      Pattern:
      <select
        value={pattern}
        onChange={(e) => setPattern(Number(e.target.value))}
      >
        <option value={2}>2/4</option>
        <option value={3}>3/4</option>
        <option value={4}>4/4</option>
        <option value={6}>6/8</option>
      </select>
    </label>

    <label>
      <input
        type="checkbox"
        checked={sound}
        onChange={(e) => setSound(e.target.checked)}
      />
      Sound
    </label>

    <label>
      <input
        type="checkbox"
        checked={vibe}
        onChange={(e) => setVibe(e.target.checked)}
      />
      Vibration
    </label>

    <button onClick={() => setRunning(!running)}>
      {running ? 'Stop' : 'Start'}
    </button>
  </>
}

export default App
