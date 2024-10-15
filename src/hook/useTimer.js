import { useEffect, useRef, useState } from 'react'


export default function useTimer(callback, initialDuration = 1000) {
  const previousTimeRef = useRef(null)
  const animationFrameRef = useRef(null)
  const [duration, setDuration] = useState(initialDuration)
  
  
  const tick = () => {
    const now = Date.now()
    const elapsed = previousTimeRef.current ? now - previousTimeRef.current : 0
    
    if (elapsed >= duration) {
      callback(elapsed)
      previousTimeRef.current = now
    } else if (!previousTimeRef.current) {
      previousTimeRef.current = now
    }
    
    animationFrameRef.current = requestAnimationFrame(tick)
  }
  
  
  useEffect(() => {
    // Start the timer
    animationFrameRef.current = requestAnimationFrame(tick)
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [duration, callback])
  
  
  return [duration, setDuration]
}