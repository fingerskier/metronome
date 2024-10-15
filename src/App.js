import {useEffect, useState} from 'react'
import Meter from './com/Meter'
import Tempo from './com/Tempo'
import useBeep from './hook/useBeep'
import useTimer from './hook/useTimer'

import './App.css'


export default function App() {
  const {beep} = useBeep()
  
  const [running, setRunning] = useState(false)
  const [tempo, setTempo] = useState(60)
  const [meter, setMeter] = useState('4/4')
  
  const [duration, setDuration] = useTimer(dT=>{
    if (running) {
      beep()
    }
  }, 60000 / tempo)
  
  
  useEffect(() => {
    if (tempo) {
      setDuration(60000 / tempo)
    }
  }, [tempo])
  
  
  return <>
    <header>
      <h1>Metronome</h1>
    </header>
    
    <main>
      <button onClick={E=>setRunning(!running)}>
        {running ? 'Stop' : 'Start'}
      </button>
      
      <Tempo tempo={tempo} setTempo={setTempo} />
      
      <Meter meter={meter} setMeter={setMeter} />
    </main>
  </>
}