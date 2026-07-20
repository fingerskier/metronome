import { describe, expect, it } from 'vitest'
import {
  buildVibrationPattern,
  clampBurst,
  MAX_ENTRY_MS,
  MAX_VIBE_ENTRIES,
  PULSE_ACCENT_MS,
  PULSE_NORMAL_MS,
  type VibeBeat,
} from './vibrationPattern'

/** A tempo grid: `count` beats, `spb` apart, accented every `patternLen`th. */
function grid(
  start: number,
  spb: number,
  count: number,
  patternLen = 4,
  firstIndex = 0,
): VibeBeat[] {
  return Array.from({ length: count }, (_, i) => ({
    time: start + i * spb,
    accent: (firstIndex + i) % patternLen === 0,
  }))
}

describe('clampBurst', () => {
  it('keeps a burst that fits inside the duty budget', () => {
    // 120bpm -> 500ms spacing -> a 300ms budget, and the accent burst spans
    // 120+40+80 = 240ms.
    expect(clampBurst(PULSE_ACCENT_MS, 500)).toEqual([120, 40, 80])
  })

  it('degrades a multi-pulse burst to its leading pulse rather than truncating mid-burst', () => {
    // 300bpm -> 200ms spacing -> a 120ms budget. Truncating to [120, 40] would
    // end the beat on a silent gap, which reads as a shorter buzz rather than
    // a double-hit; dropping to the leading pulse keeps the accent both whole
    // and still longer than a normal beat.
    expect(clampBurst(PULSE_ACCENT_MS, 200)).toEqual([120])
  })

  it('shortens a single pulse that overruns the budget', () => {
    expect(clampBurst([PULSE_NORMAL_MS], 60)).toEqual([36])
  })

  it('never returns a zero-length pulse', () => {
    // A zero-length entry silences the beat outright: the vibrator is asked to
    // run for 0ms and the surrounding gaps simply fuse.
    for (let spacing = 1; spacing <= 40; spacing++) {
      for (const pulses of [PULSE_ACCENT_MS, [PULSE_NORMAL_MS]]) {
        clampBurst(pulses, spacing).forEach((entry) => {
          expect(entry).toBeGreaterThanOrEqual(1)
        })
      }
    }
  })
})

describe('buildVibrationPattern', () => {
  it('emits a leading pair then alternating pulse and gap entries', () => {
    // The scheduler's very first pass at 120bpm in 4/4: the downbeat is
    // committed at START_OFFSET (0.05), the next two beats are projected.
    const beats: VibeBeat[] = [
      { time: 0.05, accent: true },
      { time: 0.55, accent: false },
      { time: 1.05, accent: false },
    ]

    const batch = buildVibrationPattern(beats, 0, 0.5)

    //  0,50   -- a zero-length buzz then a 50ms pause, the only way the
    //            Vibration API can express "start 50ms from now"
    //  120,40,80 -- the accent burst
    //  260    -- 500ms spacing less the 240ms burst
    //  70     -- an offbeat
    //  430,70 -- 500ms less 70ms, then the last offbeat
    expect(batch.pattern).toEqual([0, 50, 120, 40, 80, 260, 70, 430, 70])
    expect(batch.emitted).toBe(3)
    expect(batch.coversThrough).toBeCloseTo(1.05, 9)
  })

  it('reports reissueAt at the end of the last emitted pulse', () => {
    // Not at the last BEAT: re-issuing between the beat and the end of its
    // pulse would truncate a buzz that is still running.
    const beats: VibeBeat[] = [
      { time: 0.05, accent: true },
      { time: 0.55, accent: false },
      { time: 1.05, accent: false },
    ]

    const batch = buildVibrationPattern(beats, 0, 0.5)

    expect(batch.reissueAt).toBeCloseTo(1.12, 9)
  })

  it('keeps a beat that is due exactly now and omits the leading pair', () => {
    // A lead of zero would burn two of the ten available entries to express
    // "start immediately".
    const batch = buildVibrationPattern(
      [
        { time: 2, accent: false },
        { time: 2.5, accent: false },
      ],
      2,
      0.5,
    )

    expect(batch.pattern).toEqual([70, 430, 70])
  })

  it('drops beats already in the past and anchors on the first future beat', () => {
    // A past-due beat cannot be expressed at all -- the API has no notion of
    // "this should already have fired" -- and buzzing it late would land it
    // between two clicks. drain() already drops stale beats for the same
    // reason.
    const batch = buildVibrationPattern(
      [
        { time: 0.6, accent: true },
        { time: 2.1, accent: false },
        { time: 2.6, accent: false },
      ],
      2,
      0.5,
    )

    expect(batch.pattern).toEqual([0, 100, 70, 430, 70])
    expect(batch.emitted).toBe(2)
  })

  it('returns an empty pattern when every beat is in the past', () => {
    const batch = buildVibrationPattern(
      [
        { time: 0.5, accent: true },
        { time: 1 , accent: false },
      ],
      9,
      0.5,
    )

    expect(batch.pattern).toEqual([])
    expect(batch.emitted).toBe(0)
    expect(batch.reissueAt).toBe(-Infinity)
    expect(batch.coversThrough).toBe(-Infinity)
  })

  it('never emits a negative, fractional, or over-long entry', () => {
    // navigator.vibrate takes `unsigned long` with neither [Clamp] nor
    // [EnforceRange], so a negative entry converts modulo 2**32 and is then
    // clamped UP to the spec's max duration -- one stray negative is a
    // ten-second solid buzz, not a dropped entry.
    for (let bpm = 30; bpm <= 1000; bpm += 7) {
      const spb = 60 / bpm
      // Lead with a stale beat so the past-due path is exercised too.
      const beats = grid(-spb, spb, 40)

      const { pattern } = buildVibrationPattern(beats, 0.013, spb)

      pattern.forEach((entry) => {
        expect(Number.isInteger(entry)).toBe(true)
        expect(entry).toBeGreaterThanOrEqual(0)
        expect(entry).toBeLessThanOrEqual(MAX_ENTRY_MS)
      })
    }
  })

  it('never exceeds the ten-entry portable pattern cap', () => {
    // The Vibration API's "max length" is implementation-dependent but at
    // least 10, and over-long patterns are truncated SILENTLY -- a dropped
    // tail would leave a hole the caller believes it covered.
    for (let bpm = 30; bpm <= 1000; bpm += 7) {
      const spb = 60 / bpm
      const beats = grid(-spb, spb, 40)

      const { pattern } = buildVibrationPattern(beats, 0.013, spb)

      expect(pattern.length).toBeLessThanOrEqual(MAX_VIBE_ENTRIES)
    }
  })

  it('truncates at a beat boundary, never mid-burst', () => {
    // 300bpm: 200ms spacing, a 120ms budget, so the accent degrades to [120].
    // Lead(2) + accent(1) + three offbeats(2 each) = 9 entries; a fourth
    // offbeat would need 11, so the batch must stop after four whole beats.
    const beats = grid(0.05, 0.2, 8)

    const batch = buildVibrationPattern(beats, 0, 0.2)

    expect(batch.pattern).toEqual([0, 50, 120, 80, 70, 130, 70, 130, 70])
    expect(batch.emitted).toBe(4)
    expect(batch.coversThrough).toBeCloseTo(beats[3].time, 9)
  })

  it('never emits a zero-length gap, and an accent plus its gap fills the spacing at 300bpm', () => {
    const batch = buildVibrationPattern(grid(0.05, 0.2, 8), 0, 0.2)

    // Entries after the leading pair alternate pulse, gap, pulse, gap...
    // Index 2 is the accent pulse and index 3 the gap that follows it.
    expect(batch.pattern[2] + batch.pattern[3]).toBe(200)
    batch.pattern.slice(1).forEach((entry) => {
      expect(entry).toBeGreaterThanOrEqual(1)
    })
  })

  it('computes gaps from the actual beat deltas, not from secondsPerBeat', () => {
    // A batch spans the seam between beats already committed at the old tempo
    // and beats projected at the new one. Spacing the whole run by the current
    // secondsPerBeat would put buzzes where there are no clicks.
    const beats: VibeBeat[] = [
      { time: 0.5, accent: true }, // committed at 120bpm
      { time: 1, accent: false }, // committed at 120bpm
      { time: 1.25, accent: false }, // projected at 240bpm
      { time: 1.5, accent: false },
    ]

    const batch = buildVibrationPattern(beats, 0, 0.25)

    //           lead   accent      gap 500-240  pulse  gap 250-70  pulse
    expect(batch.pattern).toEqual([0, 500, 120, 40, 80, 260, 70, 180, 70])
    // The fourth beat needs a gap plus a pulse and would overrun the cap, so
    // the batch stops cleanly after the third.
    expect(batch.emitted).toBe(3)
    expect(batch.coversThrough).toBeCloseTo(1.25, 9)
  })
})
