import { useEffect, useRef, useState } from 'react'
import { useLocalStorage } from 'react-use'
import useTimer from './hook/useTimer'
import useBeep from './hook/useBeep'
import useVibrate from './hook/useVibrate'

import './App.css'


export default function App() {
  const [bpm, setBpm] = useLocalStorage('bpm', 120)
  const [pattern, setPattern] = useLocalStorage('pattern', 4)
  const [sound, setSound] = useLocalStorage('sound', true)
  const [vibe, setVibe] = useLocalStorage('vibe', false)

  const [running, setRunning] = useState(false)

  const { beep, resumeAudio } = useBeep()
  const vibrate = useVibrate()
  const beatRef = useRef(0)
  const { start, stop, setDuration } = useTimer(() => {
    beatRef.current = (beatRef.current + 1) % (pattern ?? 4)
    const accent = beatRef.current === 0
    if (sound) {
      beep(accent)
    }
    if (vibe) vibrate(accent)
  }, 60000 / (bpm ?? 120))

  
  useEffect(() => {
    const newDuration = 60000 / (bpm ?? 120)
    setDuration(newDuration)
  }, [bpm, setDuration])


  useEffect(() => {
    if (running) {
      const startAudio = async () => {
        try {
          await resumeAudio() // Wait for audio context to resume
          start()
        } catch (error) {
          console.error('Failed to resume audio:', error)
          start() // Start anyway even if audio fails
        }
      }
      startAudio()
    } else {
      stop()
    }
  }, [running, start, stop, resumeAudio])


  return <>
    <h1>Metronome</h1>

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
    </div>

    <div className="row">
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
      <label htmlFor="sound"> Sound </label>
    
      <input
        type="checkbox"
        id="sound"
        checked={sound}
        onChange={(e) => setSound(e.target.checked)}
      />
    </div>

    <div className="row">
      <label htmlFor="vibe"> Vibration </label>


      <input
        type="checkbox"
        id="vibe"
        checked={vibe}
        onChange={(e) => setVibe(e.target.checked)}
      />
    </div>

    <button onClick={() => setRunning(!running)}>
      {running ? 'Stop' : 'Start'}
    </button>
  </>
}