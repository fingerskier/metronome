# Web Audio lookahead scheduler

**Date:** 2026-07-20
**Status:** approved, not yet implemented
**Fixes:** the remaining half of the tempo-accuracy issue — per-beat audio jitter and background-tab stalling

## Problem

Beats are produced by a `requestAnimationFrame` loop in `useTimer`, which calls
`beep()` on the main thread. Two consequences follow from that:

1. **Jitter.** A beat can only fire on a frame boundary (~16.7ms at 60Hz), so
   every click lands up to a frame late. An earlier fix made the *average* tempo
   correct (mean error 1.80% → 0.040%) by carrying the overshoot forward, but
   each individual beat still scatters ±16ms around that correct average.
2. **Stalling.** Browsers throttle or pause `requestAnimationFrame` in hidden
   tabs, so the metronome stops when the tab is not in front.

Both come from the same root cause: timing is driven by the display clock rather
than the audio clock.

## Approach

Schedule notes ahead of time on the `AudioContext` clock, which runs on audio
hardware and is unaffected by main-thread scheduling. A periodic tick wakes up,
looks a short distance into the future, and schedules any beats that fall within
that window via `osc.start(when)`.

This is the standard "A Tale of Two Clocks" pattern. The tick comes from a
Worker because hidden-tab timers on the main thread throttle to roughly 1Hz.

## Scope

**In scope:** desktop tab-switching. Audio must keep playing when the tab is
backgrounded or the window is minimised.

**Explicitly out of scope:** iOS screen-lock and Android screen-off. iOS Safari
suspends Web Audio on screen lock, and the workaround — holding an audio session
open with a silent looping buffer — is fragile and breaks across OS updates. No
keepalive buffer, no wake lock. Mobile screen-off stopping the metronome is
accepted behaviour.

## Accepted consequence

Audio survives backgrounding. **The visual blip and vibration do not.**
`navigator.vibrate` cannot be scheduled ahead, and rAF stops when the tab is
hidden. So while hidden the user hears clicks but sees nothing, and beats that
elapse while hidden are dropped rather than replayed on return.

This is a deliberate trade, not an oversight.

## Components

```
scheduler.worker.ts   bare timer: postMessage('tick') on setInterval. Nothing else.
useBeep               scheduleBeep(when, accent), resumeAudio(), audioTime()
useBeatScheduler      Worker + lookahead loop + beat/accent phase + rAF drain
App                   supplies onBeat -> blip + vibration
```

### `scheduler.worker.ts`

Deliberately trivial. Accepts `{type: 'start', interval}` and `{type: 'stop'}`,
posts `'tick'` on an interval. It holds no scheduling logic — keeping it dumb
means all the real behaviour stays testable on the main thread.

### `useBeep`

Changes from *play now* to *play at a given time*:

- `scheduleBeep(when, accent)` — builds an oscillator and gain, `osc.start(when)`,
  ramps down, `osc.stop(when + 0.1)`. `when` is an absolute AudioContext time.
  Returns the oscillator so the caller can cancel it.
- `resumeAudio()` — unchanged; resumes a suspended context after a user gesture.
- `audioTime()` — reads `ctx.currentTime`, so the scheduler can consult the
  audio clock without owning the context.

Tone synthesis only. It does not know what a beat or a tempo is.

### `useBeatScheduler`

Owns timing. Takes `{bpm, pattern, running, sound, onBeat}`.

- Holds `nextNoteTime` on the audio clock and the beat phase counter.
- On each Worker tick: while `nextNoteTime < audioTime() + lookahead`, schedule
  a beep, push `{audioTime, beat, accent}` onto a private queue, then advance
  `nextNoteTime += 60 / bpm` and step the beat phase.
- Runs an rAF loop that drains the queue, calling `onBeat(beat, accent)` for
  beats whose time has arrived.

The queue is private. `App` never sees audio timestamps — it is told "beat 3,
accented" at the right moment and nothing more.

### `App`

Supplies `onBeat`, which sets the blip state and vibrates. `useTimer` is
retired.

## Two requirements that are easy to miss

### Stop must cancel the future

Notes are scheduled up to a lookahead *ahead* of now. A naive `stop()` leaves
already-scheduled beeps to fire into the silence after the user hit Stop. The
scheduler must retain the oscillator nodes it has scheduled and `stop()` them on
halt, then clear the queue.

### Adaptive lookahead

A lookahead long enough to survive a throttled hidden tab (~2s) means a BPM
change does nothing for two seconds, because the next two seconds of beats are
already scheduled at the old tempo. For a metronome that is unacceptable — the
tempo control would feel broken.

Resolution: **~100ms lookahead while visible, ~2s while hidden**, switched on
`visibilitychange`. Tempo changes feel instant when the user is looking at the
app, and the schedule runs far enough ahead to survive throttling when they are
not. Nobody adjusts tempo while the tab is hidden, so no cancel-and-reschedule
machinery is needed on tempo change.

## Behaviour details

These are spelled out because they are otherwise easy to guess wrong.

**Sound toggled off.** The scheduler still advances the beat phase and still
queues beat events, so the blip and vibration keep working with the sound
muted. It simply does not call `scheduleBeep`. Muting is not pausing.

**Tempo change.** The next note is scheduled using the new interval. While
visible the lookahead is ~100ms, so at most one beat is already committed at the
old tempo — a change is effectively immediate. No cancellation is needed.

**Pattern change.** The beat phase is *not* reset, matching today's behaviour.
This means the accent can land mid-bar after switching time signature. That is a
pre-existing cosmetic quirk, unrelated to timing, and is deliberately left
unchanged so this work stays scoped to the clock.

**Start.** The first beat is scheduled a few milliseconds into the future rather
than at `audioTime()` exactly, since a note scheduled at or before the current
time plays immediately and with no envelope precision. The beat phase resets on
start, so the first beat of a run is always the accented downbeat.

## Testing

jsdom provides no `Worker`, so tests need a `src/test/workerStub.ts` that lets
them drive ticks manually. This mirrors the existing `src/test/audioStub.ts`
pattern, installed the same way from `src/test/setup.ts`.

Coverage:

- **Scheduled audio times are exactly `n × 60/bpm` apart.** This is the headline
  test and it is a stronger guarantee than the one it replaces — an exact
  assertion on the hardware clock, where the current suite can only assert a
  statistical average period.
- Accent lands on beat 0 of the pattern, and the first beat after `start()` is
  an accented downbeat.
- Beat events are still queued when sound is muted, and no oscillator is built.
- `stop()` cancels pending scheduled audio and no further beeps sound.
- Lookahead switches on `visibilitychange`.
- No burst of `onBeat` calls after a long hidden stretch — stale queued beats
  are dropped, not replayed. This is the same hazard as the stall guard already
  present in `useTimer`.
- `useBeep` schedules at the requested time, and keeps its existing
  frequency/gain behaviour (880/full for accent, 440/half otherwise).

## Migration

`useTimer` and its 12 tests are retired. Its contract — a wall-clock interval
callback — is the wrong abstraction once the audio clock is the source of truth;
keeping it would mean two competing clocks driving the same beat.

The tempo guarantee does not disappear, it moves somewhere stricter. Net test
count is expected to rise.

## Risk to verify early

The worker chunk must build under Vite 8 / Rolldown **and** be precached
correctly by vite-plugin-pwa. Worker bundling is the one part of this that
cannot be confirmed by reading the code, so it gets checked against a real build
before the rest is built out.

`main` now auto-deploys on push, so a broken worker chunk would ship — though
tests and lint gate the workflow.
