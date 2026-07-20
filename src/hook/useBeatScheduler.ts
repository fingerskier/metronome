import { useEffect, useRef } from 'react'
import useBeep from '@/hook/useBeep'

/** How often the worker wakes us to top up the schedule, in ms. */
const TICK_MS = 25
/** How far ahead to commit beats while the tab is visible, in seconds. */
const LOOKAHEAD_VISIBLE = 0.1
/** The first beat lands this far in the future; scheduling at exactly
 *  currentTime plays immediately and loses envelope precision. */
const START_OFFSET = 0.05
/** Well above the UI ceiling of 300, so it never interferes with real use. */
const MAX_BPM = 1000
/** Hard backstop making the scheduling loop provably terminating for ANY
 *  input. At the widest lookahead and MAX_BPM this is never reached. */
const MAX_BEATS_PER_PASS = 256

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
      // Clamp on finiteness AND positivity, not truthiness. A negative bpm is
      // truthy and yields a negative secondsPerBeat, walking the loop away
      // from its horizon; Infinity -- reachable by typing "1e400", since a
      // number input's min/max are advisory -- yields zero, so the loop never
      // advances at all. Both hang the tab synchronously on the main thread.
      const bpm =
        Number.isFinite(params.bpm) && params.bpm > 0
          ? Math.min(params.bpm, MAX_BPM)
          : 120
      const secondsPerBeat = 60 / bpm
      const pattern =
        Number.isFinite(params.pattern) && params.pattern > 0
          ? Math.floor(params.pattern)
          : 4
      const horizon = audioTime() + lookaheadRef.current

      // The count is a backstop, not a policy: clamping bpm already bounds the
      // beats per pass. It exists so no future input can reintroduce a hang.
      let committed = 0
      while (nextNoteTime < horizon && committed < MAX_BEATS_PER_PASS) {
        const accent = beat === 0

        // Muting silences the click but must not pause the beat -- the blip and
        // vibration keep working.
        if (params.sound) {
          scheduleBeep(nextNoteTime, accent)
        }

        nextNoteTime += secondsPerBeat
        // Same reasoning as the bpm guard above: a negative pattern is
        // truthy, and while it can't hang the loop, it corrupts the accent
        // cycle through JavaScript's signed modulo.
        beat = (beat + 1) % pattern
        committed++
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
