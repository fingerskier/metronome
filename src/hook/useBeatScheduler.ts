import { useEffect, useRef } from 'react'
import useBeep from '@/hook/useBeep'

/** How often the worker wakes us to top up the schedule, in ms. */
const TICK_MS = 25
/** How far ahead to commit beats while the tab is visible, in seconds. */
const LOOKAHEAD_VISIBLE = 0.1
/** How far ahead while hidden -- must outlast throttled timers. Consumed by
 *  the visibility-listener task that widens `lookaheadRef` when the tab is
 *  backgrounded; kept here (and exported) so `noUnusedLocals` doesn't flag it
 *  before that wiring lands. */
export const LOOKAHEAD_HIDDEN = 2
/** The first beat lands this far in the future; scheduling at exactly
 *  currentTime plays immediately and loses envelope precision. */
const START_OFFSET = 0.05

export type BeatSchedulerOptions = {
  bpm: number
  pattern: number
  sound: boolean
  running: boolean
  onBeat: (beat: number, accent: boolean) => void
}

/**
 * Owns metronome timing. Beats are committed to the AudioContext clock ahead of
 * time, so playback is immune to main-thread scheduling and survives a
 * backgrounded tab.
 */
export default function useBeatScheduler({
  bpm,
  pattern,
  sound,
  running,
  onBeat,
}: BeatSchedulerOptions) {
  const { scheduleBeep, resumeAudio, audioTime } = useBeep()

  // The scheduling loop must see the newest settings without being torn down
  // and restarted on every keystroke. Written in an effect, never during
  // render -- react-hooks/refs forbids the latter.
  const paramsRef = useRef({ bpm, pattern, sound, onBeat })
  useEffect(() => {
    paramsRef.current = { bpm, pattern, sound, onBeat }
  }, [bpm, pattern, sound, onBeat])

  const lookaheadRef = useRef(LOOKAHEAD_VISIBLE)

  useEffect(() => {
    if (!running) return

    let cancelled = false
    let worker: Worker | null = null

    let nextNoteTime = 0
    let beat = 0

    const scheduleAhead = () => {
      const params = paramsRef.current
      const secondsPerBeat = 60 / (params.bpm || 120)
      const horizon = audioTime() + lookaheadRef.current

      while (nextNoteTime < horizon) {
        const accent = beat === 0

        // Muting silences the click but must not pause the beat -- the blip and
        // vibration keep working.
        if (params.sound) {
          scheduleBeep(nextNoteTime, accent)
        }

        nextNoteTime += secondsPerBeat
        beat = (beat + 1) % (params.pattern || 4)
      }
    }

    const begin = async () => {
      try {
        await resumeAudio()
      } catch {
        // A blocked context should not stop the visual metronome.
      }
      if (cancelled) return

      nextNoteTime = audioTime() + START_OFFSET
      beat = 0

      worker = new Worker(
        new URL('../worker/scheduler.worker.ts', import.meta.url),
        { type: 'module' },
      )
      worker.onmessage = () => {
        scheduleAhead()
      }
      worker.postMessage({ type: 'start', interval: TICK_MS })

      scheduleAhead()
    }

    void begin()

    return () => {
      cancelled = true

      if (worker) {
        worker.postMessage({ type: 'stop' })
        worker.terminate()
      }
    }
  }, [running, audioTime, scheduleBeep, resumeAudio])

  return { resumeAudio }
}
