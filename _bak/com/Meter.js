import {useEffect, useState} from 'react'


export default function Meter({meter, setMeter}) {
  const [denominator, setDenominator] = useState(4)
  const [numerator, setNumerator] = useState(4)
  
  
  useEffect(() => {
    setMeter(`${numerator}/${denominator}`)
  }, [numerator, denominator])
  
  
  return <div>
    Meter:
    
    <select 
      value={numerator} 
      onChange={E=>setNumerator(+E.target.value)}
    >
      <option value={1}>1</option>
      <option value={2}>2</option>
      <option value={3}>3</option>
      <option value={4}>4</option>
      <option value={5}>5</option>
      <option value={6}>6</option>
    </select>
    &nbsp;
    /
    &nbsp;
    <select
      value={denominator}
      onChange={E=>setDenominator(+E.target.value)}
    >
      <option value={1}>1</option>
      <option value={2}>2</option>
      <option value={4}>4</option>
      <option value={8}>8</option>
      <option value={16}>16</option>
    </select>
  </div>
}