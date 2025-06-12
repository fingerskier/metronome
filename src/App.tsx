import { useEffect, useRef, useState } from 'react'
import { useLocalStorage } from 'react-use'
import useTimer from '@/hook/useTimer'
import useBeep from '@/hook/useBeep'
import useVibrate from '@/hook/useVibrate'
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

  const { beep, resumeAudio } = useBeep()
  const vibrate = useVibrate()
  const beatRef = useRef(0)
  const { start, stop, setDuration } = useTimer((delta) => {
    setTick(true)

    beatRef.current = (beatRef.current + 1) % (pattern ?? 4)
    const accented = beatRef.current === 0
    if (sound) {
      beep(accented)
    }
    if (vibe) vibrate(accented)
    setAccent(accented)
    
    setTimeout(() => {
      setTick(false)
    }, 100)
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

    <button onClick={() => setRunning(!running)}>
      {running ? 'Stop' : 'Start'}
    </button>
  </>
}