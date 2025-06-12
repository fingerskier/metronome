import { useEffect, useState, useRef } from 'react'

const DOT = {
  BLACK: '⚫',
  BROWN: '🟤',
  GREEN: '🟢',
  ORANGE: '🟠',
  PURPLE: '🟣',
  accent: '🔴',
  offbeat: '⭕',
  WHITE: '⚪',
  YELLOW: '🟡',
}


export default function Blip({show=false, accent=false}) {
  const [isVisible, setIsVisible] = useState(false)
  const frameCountRef = useRef(0)
  const animationRef = useRef<number>(0)

  useEffect(() => {
    if (show) {
      setIsVisible(true)
      frameCountRef.current = 0
      
      const animate = () => {
        frameCountRef.current++
        
        // Turn off after 6 animation frames
        if (frameCountRef.current >= 6) {
          setIsVisible(false)
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
  
  return <div>{isVisible ? DOT[accent ? 'accent' : 'offbeat'] : ''}</div>
}