/**
 * Builds Vibration API patterns for a run of upcoming beats.
 *
 * Pure and React-free on purpose: nearly all of the correctness surface here is
 * arithmetic, and it is far cheaper to pin with plain unit tests than through
 * renderHook and a faked audio clock.
 */

/** One offbeat buzz, in ms. */
export const PULSE_NORMAL_MS = 70
/** An accented downbeat, as buzz/pause/buzz. */
export const PULSE_ACCENT_MS: readonly number[] = [120, 40, 80]
/** The largest share of a beat's spacing that its pulses may occupy. */
export const PULSE_DUTY = 0.6
/**
 * The Vibration API's "max length" is implementation-dependent but at least
 * 10, and an over-long pattern is truncated SILENTLY. Blink allows 99, but
 * relying on that would leave a hole wherever a stricter UA drops the tail --
 * the caller would believe it had committed beats that never buzz. 10 is the
 * only portable number.
 */
export const MAX_VIBE_ENTRIES = 10
/** The spec's "max duration" for a single entry. */
export const MAX_ENTRY_MS = 10_000

export type VibeBeat = { time: number; accent: boolean }

export type VibeBatch = {
  /** Alternating [buzz, pause, buzz, ...] ms; empty when nothing was emitted. */
  pattern: number[]
  /** Audio time of the last beat represented in `pattern`. */
  coversThrough: number
  /**
   * Audio time at which the last emitted pulse ends -- the earliest instant at
   * which replacing this pattern cannot cut a buzz short. Callers gate their
   * next vibrate() call on it.
   */
  reissueAt: number
  /** How many beats made it into `pattern`. */
  emitted: number
}

/**
 * The single choke point for every number that reaches navigator.vibrate.
 *
 * VibratePattern is `unsigned long` with neither [Clamp] nor [EnforceRange], so
 * a negative entry is converted modulo 2**32 (-1400 becomes 4294965896) and the
 * normalize step then clamps it UP to max duration: one stray negative is a
 * ten-second solid buzz, not a dropped entry. NaN and Infinity convert to 0,
 * which instead fuses two pulses into one.
 */
export function toDuration(ms: number): number {
  if (!Number.isFinite(ms)) return 0
  return Math.min(MAX_ENTRY_MS, Math.max(0, Math.round(ms)))
}

/**
 * Fits a beat's pulses inside its share of the spacing to the next beat.
 *
 * A burst that overruns its budget is degraded to its leading pulse rather than
 * truncated: cutting [120, 40, 80] to [120, 40] would end the beat on a silent
 * gap, turning the accent into a *shorter* buzz than an offbeat.
 */
export function clampBurst(
  pulses: readonly number[],
  spacingMs: number,
): number[] {
  const budget = Math.max(1, PULSE_DUTY * spacingMs)
  const span = pulses.reduce((total, p) => total + p, 0)

  const fitted =
    span <= budget ? [...pulses] : [Math.min(pulses[0], budget)]

  // Floor at 1ms: an entry that rounds to zero silences the beat entirely.
  return fitted.map((p) => Math.max(1, toDuration(p)))
}

/**
 * Turns upcoming beats into one pattern the OS vibrator can run unattended.
 *
 * `now` and every beat time are on the AudioContext clock; `secondsPerBeat`
 * only supplies the spacing *after* the final beat, which has no successor to
 * measure against.
 */
export function buildVibrationPattern(
  beats: readonly VibeBeat[],
  now: number,
  secondsPerBeat: number,
): VibeBatch {
  const empty: VibeBatch = {
    pattern: [],
    coversThrough: -Infinity,
    reissueAt: -Infinity,
    emitted: 0,
  }

  // A beat already in the past cannot be expressed -- the API has no notion of
  // "this should have fired" -- and buzzing it now would land it between two
  // clicks. drain() drops stale beats for exactly the same reason.
  let start = 0
  while (start < beats.length && beats[start].time < now) start++
  if (start >= beats.length) return empty

  const pattern: number[] = []

  // The API's only way to say "start later" is a zero-length buzz followed by
  // a pause. Skip it when the delay rounds away, rather than spending two of
  // ten entries on a sub-millisecond wait.
  const lead = toDuration((beats[start].time - now) * 1000)
  if (lead > 0) pattern.push(0, lead)

  let last = -1
  let prevDeltaMs = 0
  let prevSpan = 0

  for (let i = start; i < beats.length; i++) {
    // The ACTUAL delta, not secondsPerBeat: a batch can span the seam between
    // beats already committed at the old tempo and beats projected at the new
    // one, and spacing the whole run evenly would put buzzes where there are
    // no clicks.
    const deltaMs =
      i + 1 < beats.length
        ? (beats[i + 1].time - beats[i].time) * 1000
        : secondsPerBeat * 1000

    const pulses = clampBurst(
      beats[i].accent ? PULSE_ACCENT_MS : [PULSE_NORMAL_MS],
      deltaMs,
    )

    // The gap carried over from the previous beat -- never zero, or the two
    // pulses fuse into one long buzz and the rhythm silently changes.
    const gap = i === start ? -1 : Math.max(1, toDuration(prevDeltaMs - prevSpan))
    const entries = (gap < 0 ? 0 : 1) + pulses.length

    // Stop on a beat boundary, never part-way through a burst.
    if (pattern.length + entries > MAX_VIBE_ENTRIES) break

    if (gap >= 0) pattern.push(gap)
    pattern.push(...pulses)

    prevDeltaMs = deltaMs
    prevSpan = pulses.reduce((total, p) => total + p, 0)
    last = i
  }

  if (last < 0) return empty

  return {
    pattern,
    coversThrough: beats[last].time,
    // No trailing gap: the pattern simply ends when the vibrator goes idle.
    reissueAt: beats[last].time + prevSpan / 1000,
    emitted: last - start + 1,
  }
}
