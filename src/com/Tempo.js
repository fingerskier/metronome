import React from 'react'


export default function Tempo({tempo, setTempo}) {
  return <div>
    <label htmlFor="">
      Tempo:
      
      <input type="range" 
        min={40} 
        max={240} 
        step={1} 
        value={tempo}
        onChange={E=>setTempo(+E.target.value)}
      />
      
      {tempo}
    </label>
  </div>
}