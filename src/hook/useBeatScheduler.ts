import { useEffect, useRef } from 'react'
import useBeep, { NOTE_LENGTH } from '@/hook/useBeep'
import useVibrate from '@/hook/useVibrate'
import { buildVibrationPattern, type VibeBeat } from '@/lib/vibrationPattern'

/** How often the worker wakes us to top up the schedule, in ms. */
const TICK_MS = 25
/** How far ahead to commit beats while the tab is visible, in seconds. */
const LOOKAHEAD_VISIBLE = 0.1
/** How far ahead while hidden -- must outlast throttled timers. */
const LOOKAHEAD_HIDDEN = 2
/** The first beat lands this far in the future; scheduling at exactly
 *  currentTime plays immediately and loses envelope precision. */
const START_OFFSET = 0.05
/** Well above the UI ceiling of 300, so it never interferes with real use. */
const MAX_BPM = 1000
/** Hard backstop making the scheduling loop provably terminating for ANY
 *  input. At the widest lookahead and MAX_BPM this is never reached. */
const MAX_BEATS_PER_PASS = 256
/** Ceiling on how far ahead one vibration pattern may reach, in seconds. The
 *  Vibration API's ten-entry portable limit usually binds first; this only
 *  stops a very slow tempo from committing a pattern so long that any tempo
 *  change has to throw most of it away. */
const VIBE_HORIZON = 1.5

type BeatEvent = { time: number; beat: number; accent: boolean }

export type BeatSchedulerOptions = {
  bpm: number
  pattern: number
  sound: boolean
  vibe: boolean
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
  vibe,
  running,
  onBeat,
}: BeatSchedulerOptions) {
  const { scheduleBeep, resumeAudio, audioTime } = useBeep()
  const { vibrateBatch, cancelVibration } = useVibrate()

  // The scheduling loop must see the newest settings without being torn down
  // and restarted on every keystroke. Written in an effect, never during
  // render -- react-hooks/refs forbids the latter.
  const paramsRef = useRef({ bpm, pattern, sound, vibe, onBeat })
  useEffect(() => {
    paramsRef.current = { bpm, pattern, sound, vibe, onBeat }
  }, [bpm, pattern, sound, vibe, onBeat])

  const lookaheadRef = useRef(LOOKAHEAD_VISIBLE)

  // A lookahead wide enough to outlast a throttled hidden tab would make the
  // BPM control feel dead for two seconds, because the next two seconds of
  // beats are already committed. Widening it only while hidden gives instant
  // tempo response when the user can actually see the app, and nobody adjusts
  // tempo while the tab is in the background.
  useEffect(() => {
    const sync = () => {
      lookaheadRef.current = document.hidden
        ? LOOKAHEAD_HIDDEN
        : LOOKAHEAD_VISIBLE
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  useEffect(() => {
    if (!running) return

    let cancelled = false
    let frame = 0
    let worker: Worker | null = null

    const queue: BeatEvent[] = []
    const scheduled: { osc: OscillatorNode; endsAt: number }[] = []
    let nextNoteTime = 0
    let beat = 0

    // Vibration bookkeeping. None of these is a clock: they are all either
    // compared against `now` or assigned wholesale. A second beat cursor was
    // deliberately NOT introduced -- two accumulators advancing at different
    // beat indices de-phase permanently on the stall path below.
    /** Audio time from which replacing the running pattern is safe. */
    let vibeReissueAt = -Infinity
    /** Whether a pattern is believed to be running on the OS vibrator. */
    let vibeArmed = false
    /** The tempo and pattern length the in-flight batch was built for. */
    let vibeSpb = 0
    let vibePatternLen = 0
    let vibeHidden = document.hidden

    const invalidateVibe = () => {
      // navigator.vibrate replaces rather than appends, so a stale pattern can
      // only be dropped, never amended.
      if (vibeArmed) cancelVibration()
      vibeArmed = false
      vibeReissueAt = -Infinity
    }

    /**
     * The beats one pattern should cover, as a single grid in two segments.
     *
     * Segment one is what is already committed to the AudioContext: those
     * beats WILL click, at whatever tempo was in force when they were
     * committed, so re-spacing them at the current tempo would put buzzes
     * where there are no clicks. Segment two continues from the audio cursor
     * on the current grid.
     */
    const collectVibeBeats = (
      now: number,
      secondsPerBeat: number,
      patternLength: number,
    ) => {
      const beats: VibeBeat[] = []

      // Filter on time, never on index: scheduleAhead prunes `queue` only down
      // to length 1, so it can still be holding one already-elapsed entry.
      for (const event of queue) {
        if (event.time > now) beats.push({ time: event.time, accent: event.accent })
      }

      // nextNoteTime is by construction the first UNcommitted beat, so the two
      // segments abut with neither a gap nor a duplicate.
      let time = nextNoteTime
      let index = beat
      let guard = 0
      while (time <= now + VIBE_HORIZON && guard++ < MAX_BEATS_PER_PASS) {
        if (time > now) beats.push({ time, accent: index === 0 })
        time += secondsPerBeat
        index = (index + 1) % patternLength
      }

      return beats
    }

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
      const now = audioTime()

      // A long stall (system sleep, or a hidden page throttled past what the
      // lookahead covers) leaves nextNoteTime far in the past. The threshold
      // is pinned to the widest configured lookahead, not the current
      // (possibly much narrower, e.g. 0.1s while visible) one -- otherwise an
      // ordinary multi-beat catch-up burst, or plain tick jitter, gets
      // mistaken for a stall and drops a beat that was never actually missed.
      // A real stall (tens of seconds to minutes) still clears this by a wide
      // margin. Without this resync, recovery would otherwise commit every
      // missed beat at once.
      if (nextNoteTime < now - LOOKAHEAD_HIDDEN) {
        nextNoteTime = now + START_OFFSET
        // The OS is still holding a pattern built on the pre-stall grid, which
        // the resync has just moved out from under it. Drop it here; the pass
        // below rebuilds against the new cursor.
        invalidateVibe()
      }

      const horizon = now + lookaheadRef.current

      // drain() prunes these too, but rAF is parked while the tab is hidden --
      // exactly when scheduleAhead keeps running. Without pruning here, both
      // arrays grow for the whole hidden stretch and nothing is collectable.
      // Keep the last entry in each so drain can still report the last due
      // beat, and so a note isn't dropped from the cancel-on-stop list before
      // this same pass has committed its replacement.
      while (queue.length > 1 && queue[1].time <= now) queue.shift()
      while (scheduled.length > 1 && scheduled[0].endsAt <= now) scheduled.shift()

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

      const hidden = document.hidden
      if (hidden !== vibeHidden) {
        // Per the Vibration API the user agent MUST abort a running pattern
        // when visibility changes -- in BOTH directions. Whatever the OS was
        // holding is already gone, so drop the claim and let the next visible
        // pass re-arm within one tick instead of waiting out a horizon we no
        // longer own. No cancel call: there is nothing left to cancel, and a
        // call from a hidden document would be refused anyway.
        vibeHidden = hidden
        vibeArmed = false
        vibeReissueAt = -Infinity
      }

      if (!params.vibe) {
        invalidateVibe()
      } else if (!hidden) {
        // A tempo or pattern change re-phases every beat the in-flight pattern
        // covers; without this the buzz would lag the click by up to a whole
        // horizon.
        if (secondsPerBeat !== vibeSpb || pattern !== vibePatternLen) {
          invalidateVibe()
        }

        // The gate is the END of the last committed pulse -- the earliest
        // instant at which replacing the pattern cannot cut a buzz short. The
        // duty clamp keeps that instant at least 0.4 beats before the next
        // one, so this window is always several worker ticks wide.
        if (now >= vibeReissueAt) {
          const batch = buildVibrationPattern(
            collectVibeBeats(now, secondsPerBeat, pattern),
            now,
            secondsPerBeat,
          )
          if (batch.pattern.length > 0 && vibrateBatch(batch.pattern)) {
            vibeArmed = true
            vibeReissueAt = batch.reissueAt
            vibeSpb = secondsPerBeat
            vibePatternLen = pattern
          }
          // A refusal leaves the gate open, so the next 25ms tick retries.
          // That covers a hidden race, absent hardware and a permissions
          // policy alike -- recovery in one tick rather than one horizon.
        }
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
        // The audio clock is the ONLY clock here: a suspended AudioContext
        // freezes currentTime, so audioTime() returns a constant, scheduleAhead
        // commits one horizon and never advances, and drain's due-check never
        // fires -- the whole metronome (audio, blip, vibration) sits idle, not
        // just the sound. In practice this doesn't bite: `running` flips true
        // from a user gesture, so resume() succeeds.
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
      worker.onerror = (event) => {
        console.error('scheduler worker failed to start or crashed:', event)
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

      // Same reasoning as the oscillator loop below: the vibration pattern is
      // committed ahead of now, so without this it keeps buzzing after Stop.
      if (vibeArmed) cancelVibration()

      // Beats are committed ahead of now, so without this they keep sounding
      // after the user hit Stop.
      for (const { osc } of scheduled) {
        try {
          osc.stop()
          osc.disconnect()
        } catch {
          // Already stopped/disconnected, or the context closed first (useBeep
          // tears down before this cleanup runs); nothing to undo.
        }
      }
      scheduled.length = 0
      queue.length = 0
    }
  }, [
    running,
    audioTime,
    scheduleBeep,
    resumeAudio,
    vibrateBatch,
    cancelVibration,
  ])
}
