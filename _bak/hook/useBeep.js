import { useState, useEffect, useRef } from 'react'


export default function useBeep() {
  // Refs for AudioContext, GainNode, and Oscillator
  const audioContextRef = useRef(null)
  const masterGainNodeRef = useRef(null)
  const oscillatorRef = useRef(null)

  // States to control volume and frequency
  const [volume, setVolume] = useState(1) // Default volume at 100%
  const [frequency, setFrequency] = useState(440) // Default frequency 440 Hz (A4)

  // Initialize AudioContext and Master Gain Node
  useEffect(() => {
    // Create AudioContext
    const audioContext = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'playback',
    })
    audioContextRef.current = audioContext
    
    // Create Master Gain Node
    const masterGainNode = audioContext.createGain()
    masterGainNode.gain.value = volume
    masterGainNode.connect(audioContext.destination)
    masterGainNodeRef.current = masterGainNode
    
    return () => {
      // Cleanup on component unmount
      audioContext.close()
    }
  }, [])
  
  // Update volume when it changes
  useEffect(() => {
    if (masterGainNodeRef.current) {
      masterGainNodeRef.current.gain.setValueAtTime(volume, audioContextRef.current.currentTime)
    }
  }, [volume])
  
  // Beep function
  const beep = () => {
    if (!audioContextRef.current || !masterGainNodeRef.current) return
    
    // Create Oscillator and Gain Node for beep
    const oscillator = audioContextRef.current.createOscillator()
    const gainNode = audioContextRef.current.createGain()
    
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, audioContextRef.current.currentTime)
    
    // Connect oscillator -> gain node -> master gain node
    oscillator.connect(gainNode)
    gainNode.connect(masterGainNodeRef.current)

    gainNode.gain.setValueAtTime(1, audioContextRef.current.currentTime)
    oscillator.start(audioContextRef.current.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContextRef.current.currentTime + 0.1)
    oscillator.stop(audioContextRef.current.currentTime + 0.1)
    
    // Clean up oscillator when finished
    oscillator.onended = () => oscillator.disconnect()
  }

  // Setter for frequency
  const setFrequencyValue = (newFrequency) => {
    setFrequency(newFrequency)
  }
  
  // Setter for volume
  const setVolumeValue = (newVolume) => {
    setVolume(newVolume)
  }
  
  
  return {
    beep,
    frequency,
    setFrequency: setFrequency,
    volume,
    setVolume: setVolumeValue,
  }
}