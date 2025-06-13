import { useEffect, useRef } from 'react'

const DOT = {
  none: '⚫',
  BROWN: '🟤',
  accent: '🟢',
  ORANGE: '🟠',
  PURPLE: '🟣',
  // accent: '🔴',
  // offbeat: '⭕',
  offbeat: '⚪',
  YELLOW: '🟡',
}


export default function Blip({show=false, accent=false}) {
  const frameCountRef = useRef(0)
  const animationRef = useRef<number>(0)

  useEffect(() => {
    if (show) {
      frameCountRef.current = 0
      
      const animate = () => {
        frameCountRef.current++
        
        // Turn off after 6 animation frames
        if (frameCountRef.current >= 6) {
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current)
          }
        } else {
          animationRef.current = requestAnimationFrame(animate)
        }
      }
      
      animationRef.current = requestAnimationFrame(animate)
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [show])
  
  return <div style={{fontSize: '2rem'}}>
    {DOT[show ? accent ? 'accent' : 'offbeat' : 'none']}
  </div>
}