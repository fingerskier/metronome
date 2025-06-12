import { useState } from 'react'
import { useLocalStorage } from 'react-confection'

import './App.css'


function App() {
  const [bpm, setBpm] = useLocalStorage('bpm', 120)
  
  const [running, setRunning] = useState(false)


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

    <button onClick={() => setRunning(!running)}>
      {running ? 'Stop' : 'Start'}
    </button>
  </>
}

export default App
