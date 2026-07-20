import { useEffect, useRef } from 'react'
import useBeep, { NOTE_LENGTH } from '@/hook/useBeep'

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

type BeatEvent = { time: number; beat: number; accent: boolean }

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
    let frame = 0
    let worker: Worker | null = null

    const queue: BeatEvent[] = []
    const scheduled: { osc: OscillatorNode; endsAt: number }[] = []
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
      // Floor BEFORE the positivity check, not after: Math.floor(0.5) is 0,
      // and `% 0` is NaN. beat persists across calls, so a single NaN would
      // permanently kill the accent -- beat === 0 never again holds.
      const flooredPattern = Math.floor(params.pattern)
      const pattern =
        Number.isFinite(flooredPattern) && flooredPattern > 0
          ? flooredPattern
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
          const osc = scheduleBeep(nextNoteTime, accent)
          if (osc) scheduled.push({ osc, endsAt: nextNoteTime + NOTE_LENGTH })
        }

        queue.push({ time: nextNoteTime, beat, accent })

        nextNoteTime += secondsPerBeat
        // Same reasoning as the bpm guard above: a negative pattern is
        // truthy, and while it can't hang the loop, it corrupts the accent
        // cycle through JavaScript's signed modulo.
        beat = (beat + 1) % pattern
        committed++
      }
    }

    // Plain local function, not a useCallback: it schedules itself, and a
    // useCallback cannot reference its own result (react-hooks/immutability).
    const drain = () => {
      const now = audioTime()
      let due: BeatEvent | undefined

      // Take only the most recent due beat. Returning from a hidden tab leaves
      // a pile of elapsed beats queued, and firing them all would machine-gun
      // the UI instead of resyncing.
      while (queue.length > 0 && queue[0].time <= now) {
        due = queue.shift()
      }

      if (due) paramsRef.current.onBeat(due.beat, due.accent)

      // Release notes that have finished sounding. Without this the array
      // grows for the whole run and nothing can be collected until Stop.
      while (scheduled.length > 0 && scheduled[0].endsAt <= now) {
        scheduled.shift()
      }

      frame = requestAnimationFrame(drain)
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
      frame = requestAnimationFrame(drain)
    }

    void begin()

    return () => {
      cancelled = true
      if (frame) cancelAnimationFrame(frame)

      if (worker) {
        worker.postMessage({ type: 'stop' })
        worker.terminate()
      }

      // Beats are committed ahead of now, so without this they keep sounding
      // after the user hit Stop.
      for (const { osc } of scheduled) {
        try {
          osc.stop()
        } catch {
          // Already stopped or never started; nothing to undo.
        }
        osc.disconnect()
      }
      scheduled.length = 0
      queue.length = 0
    }
  }, [running, audioTime, scheduleBeep, resumeAudio])

  return { resumeAudio }
}
