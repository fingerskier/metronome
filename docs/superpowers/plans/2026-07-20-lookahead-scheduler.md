# Web Audio Lookahead Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the requestAnimationFrame beat loop with notes scheduled ahead on the AudioContext clock, so beats stop jittering and keep playing when the tab is backgrounded.

**Architecture:** A Worker posts a bare `'tick'` every 25ms. On each tick `useBeatScheduler` looks a short distance into the future and schedules any beats falling inside that window via `osc.start(when)` on the audio clock. A separate rAF loop drains a private queue and reports each beat to the UI at the moment it actually sounds. `useBeep` becomes pure tone synthesis at a given time.

**Tech Stack:** React 19.2, TypeScript 5.8, Vite 8.1.5 (Rolldown), Vitest 4.1.10, @testing-library/react 16, jsdom 29.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-20-lookahead-scheduler-design.md`. Read it first.
- Scope is **desktop tab-switching only**. No silent-buffer keepalive, no wake lock, no iOS screen-lock handling.
- Audio survives backgrounding; **visual blip and vibration do not**. Beats elapsed while hidden are dropped, never replayed.
- `tsconfig.app.json` sets `erasableSyntaxOnly: true` — **no TypeScript parameter properties** (`constructor(public x: T)`). Use explicit field declarations plus assignment. Violating this fails with `TS1294`.
- `tsconfig.app.json` sets `verbatimModuleSyntax: true` — type-only imports must use `import type`.
- `strict`, `noUnusedLocals`, `noUnusedParameters` are on.
- eslint-plugin-react-hooks 7 enforces React Compiler rules. **Never write a ref during render** (`react-hooks/refs`) — do it in an effect. **Never self-reference a `useCallback`** (`react-hooks/immutability`) — declare self-scheduling loops as plain local functions inside the effect that owns them.
- Verified by spike, do not re-litigate: Vite 8/Rolldown bundles `new Worker(new URL('./x.worker.ts', import.meta.url), {type:'module'})` natively, emits `assets/scheduler.worker-<hash>.js`, workbox precaches it, and the `/metronome/` base is baked in correctly. **No changes to `vite.config.ts` or any `tsconfig.*` are needed.**
- **Green gate, per task.** Tasks 1–6 are a refactor in flight: `src/App.tsx` still calls the old `beep()` API until Task 7, so `tsc -b` — and therefore `npm run build` — legitimately fail in between. `npm test` does NOT fail: Vitest does not typecheck, and no App test drives a beat far enough to call the missing function. During Tasks 1–6 the gate is the task's own focused test file passing, with a real red step observed first. The full `npm test`, `npm run lint` and `npm run build` must all exit 0 from **Task 7 onward**, and Task 7 is not complete until they do. Do not "fix" the intermediate failure by leaving compatibility shims behind.
- Branch is `feat/lookahead-scheduler`. Do not push; `main` auto-deploys.

---

## File Structure

**Create:**
- `src/worker/scheduler.worker.ts` — bare interval timer. Holds no scheduling logic.
- `src/hook/useBeatScheduler.ts` — owns Worker, lookahead loop, beat phase, private queue, rAF drain.
- `src/hook/useBeatScheduler.test.ts` — scheduler tests.
- `src/test/workerStub.ts` — drivable `Worker` stub for jsdom.

**Modify:**
- `src/hook/useBeep.ts` — `beep()` becomes `scheduleBeep(when, accent)`; add `audioTime()`.
- `src/hook/useBeep.test.ts` — adapt to the new surface.
- `src/test/setup.ts` — install the Worker stub alongside the existing audio stub.
- `src/App.tsx` — consume `useBeatScheduler`; delete the `useTimer` wiring.

**Delete:**
- `src/hook/useTimer.ts`
- `src/hook/useTimer.test.ts`

---

### Task 1: `useBeep` schedules at a given audio time

**Files:**
- Modify: `src/hook/useBeep.ts`
- Test: `src/hook/useBeep.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useBeep(): { scheduleBeep(when: number, accent?: boolean): OscillatorNode | null, resumeAudio(): Promise<void>, audioTime(): number }`. `when` is an absolute AudioContext time in seconds. Returns the oscillator so callers can cancel it; returns `null` if the context is not ready.

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe` body in `src/hook/useBeep.test.ts` with:

```ts
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import useBeep from './useBeep'
import { latestAudioContext } from '../test/audioStub'

describe('useBeep', () => {
  it('starts and stops the note at the requested audio time', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(1.25, false)
    })

    const osc = latestAudioContext().oscillators.at(-1)!
    expect(osc.start).toHaveBeenCalledWith(1.25)
    expect(osc.stop).toHaveBeenCalledWith(1.25 + 0.1)
  })

  it('plays a 440Hz sine at half gain on an offbeat', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(0.5, false)
    })

    const ctx = latestAudioContext()
    const osc = ctx.oscillators.at(-1)!
    expect(osc.type).toBe('sine')
    expect(osc.frequency.value).toBe(440)
    expect(ctx.gains.at(-1)!.gain.value).toBe(0.5)
  })

  it('accents an octave up at full gain', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(0.5, true)
    })

    const ctx = latestAudioContext()
    expect(ctx.oscillators.at(-1)!.frequency.value).toBe(880)
    expect(ctx.gains.at(-1)!.gain.value).toBe(1)
  })

  it('ramps the note down relative to its own start time', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(2, false)
    })

    const ctx = latestAudioContext()
    expect(
      ctx.gains.at(-1)!.gain.exponentialRampToValueAtTime,
    ).toHaveBeenCalledWith(0.0001, 2.1)
  })

  it('returns the oscillator so the caller can cancel it', () => {
    const { result } = renderHook(() => useBeep())

    let returned: unknown
    act(() => {
      returned = result.current.scheduleBeep(0.5, false)
    })

    expect(returned).toBe(latestAudioContext().oscillators.at(-1))
  })

  it('reports the current audio clock time', () => {
    const { result } = renderHook(() => useBeep())
    latestAudioContext().currentTime = 3.5

    expect(result.current.audioTime()).toBe(3.5)
  })

  it('builds one oscillator per scheduled beat', () => {
    const { result } = renderHook(() => useBeep())

    act(() => {
      result.current.scheduleBeep(0.1, true)
      result.current.scheduleBeep(0.6, false)
      result.current.scheduleBeep(1.1, false)
    })

    expect(latestAudioContext().oscillators).toHaveLength(3)
  })

  it('resumes a context the browser suspended until first gesture', async () => {
    const { result } = renderHook(() => useBeep())
    const ctx = latestAudioContext()
    ctx.state = 'suspended'

    await act(async () => {
      await result.current.resumeAudio()
    })

    expect(ctx.resume).toHaveBeenCalled()
    expect(ctx.state).toBe('running')
  })

  it('leaves an already-running context alone', async () => {
    const { result } = renderHook(() => useBeep())
    const ctx = latestAudioContext()

    await act(async () => {
      await result.current.resumeAudio()
    })

    expect(ctx.resume).not.toHaveBeenCalled()
  })

  it('closes the context on unmount', () => {
    const { unmount } = renderHook(() => useBeep())
    const ctx = latestAudioContext()

    unmount()

    expect(ctx.close).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hook/useBeep.test.ts`
Expected: FAIL — `result.current.scheduleBeep is not a function`.

- [ ] **Step 3: Implement the new surface**

Replace `src/hook/useBeep.ts` entirely:

```ts
import { useCallback, useEffect, useRef } from 'react'

/** How long a single click rings, in seconds. */
const NOTE_LENGTH = 0.1

/**
 * Tone synthesis for the metronome click. Knows nothing about tempo or beats --
 * callers say exactly when, on the AudioContext clock, each note should sound.
 */
export default function useBeep() {
  const contextRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)

  useEffect(() => {
    const ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    const ctx = new ctor()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    contextRef.current = ctx
    gainRef.current = gain
    return () => {
      ctx.close()
    }
  }, [])

  const resumeAudio = useCallback(async () => {
    const ctx = contextRef.current
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume()
    }
  }, [])

  /** The audio hardware clock. The scheduler's only source of truth for time. */
  const audioTime = useCallback(() => contextRef.current?.currentTime ?? 0, [])

  /**
   * Schedules one click to sound at `when` (absolute AudioContext time).
   * Returns the oscillator so a caller can cancel a note it has committed to
   * but no longer wants -- see the scheduler's stop path.
   */
  const scheduleBeep = useCallback((when: number, accent = false) => {
    const ctx = contextRef.current
    const gain = gainRef.current
    if (!ctx || !gain) {
      return null
    }
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = accent ? 880 : 440
    g.gain.value = accent ? 1 : 0.5
    osc.connect(g)
    g.connect(gain)
    osc.start(when)
    // Ramp relative to this note's own start, not to ctx.currentTime -- the
    // note may be scheduled well into the future.
    g.gain.exponentialRampToValueAtTime(0.0001, when + NOTE_LENGTH)
    osc.stop(when + NOTE_LENGTH)
    return osc
  }, [])

  return { scheduleBeep, resumeAudio, audioTime }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hook/useBeep.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

`useTimer` still calls the old `beep()` via App, so the full suite is red until Task 6. Commit this file pair only.

```bash
git add src/hook/useBeep.ts src/hook/useBeep.test.ts
git commit -m "refactor(beep): schedule notes at an absolute audio time"
```

---

### Task 2: Worker and its drivable test stub

**Files:**
- Create: `src/worker/scheduler.worker.ts`
- Create: `src/test/workerStub.ts`
- Modify: `src/test/setup.ts`

**Interfaces:**
- Produces: a worker that accepts `{type:'start', interval:number}` and `{type:'stop'}` and posts the string `'tick'` on each interval.
- Produces: `StubWorker` with `static instances: StubWorker[]`, `posted: unknown[]`, and a test-only `tick()` that fires `onmessage`. Also `installWorkerStub()` and `latestWorker(): StubWorker`.

- [ ] **Step 1: Write the worker**

Create `src/worker/scheduler.worker.ts`:

```ts
/// <reference lib="webworker" />

// Without this declaration `self` resolves to the DOM's Window inside this
// file, so worker-illegal code (document, window) would typecheck cleanly and
// only fail at runtime. Shadowing the global is what makes the types honest.
declare const self: DedicatedWorkerGlobalScope

type SchedulerCommand =
  | { type: 'start'; interval: number }
  | { type: 'stop' }

let timer: ReturnType<typeof setInterval> | undefined

// Deliberately dumb: this worker owns no scheduling logic, only a heartbeat.
// Main-thread timers throttle to ~1Hz in hidden tabs; a worker's do not, which
// is the entire reason this file exists.
self.onmessage = (event: MessageEvent<SchedulerCommand>) => {
  const command = event.data

  if (command.type === 'start') {
    if (timer !== undefined) clearInterval(timer)
    timer = setInterval(() => {
      self.postMessage('tick')
    }, command.interval)
  }

  if (command.type === 'stop' && timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}
```

- [ ] **Step 2: Write the stub**

Create `src/test/workerStub.ts`. Note the explicit field declarations — parameter properties are banned by `erasableSyntaxOnly`.

```ts
import { vi } from 'vitest'

/**
 * jsdom provides no Worker, and merely importing a module that constructs one
 * throws `ReferenceError: Worker is not defined` at import time -- which makes
 * an entire test file fail to collect while the run still reports "passed".
 *
 * This stub is drivable: tests call tick() to fire the worker's message
 * handler, standing in for the interval that would run in a real worker.
 */
export class StubWorker {
  static instances: StubWorker[] = []

  url: string | URL
  options: WorkerOptions | undefined
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  posted: unknown[] = []

  postMessage = vi.fn((message: unknown) => {
    this.posted.push(message)
  })

  terminate = vi.fn()
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
  dispatchEvent = vi.fn(() => true)

  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url
    this.options = options
    StubWorker.instances.push(this)
  }

  /** Test-only: fire one scheduler tick. */
  tick() {
    this.onmessage?.({ data: 'tick' } as MessageEvent)
  }
}

/** The worker most recently constructed by the code under test. */
export function latestWorker(): StubWorker {
  const worker = StubWorker.instances.at(-1)
  if (!worker) throw new Error('no Worker was constructed')
  return worker
}

/** Installs the stub globally and clears previously recorded instances. */
export function installWorkerStub() {
  StubWorker.instances = []
  Object.defineProperty(globalThis, 'Worker', {
    value: StubWorker,
    configurable: true,
    writable: true,
  })
}
```

- [ ] **Step 3: Wire it into setup**

Replace `src/test/setup.ts` entirely:

```ts
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { installAudioStub } from './audioStub'
import { installWorkerStub } from './workerStub'

// Anything that mounts App or useBeep builds an AudioContext on mount, and the
// scheduler constructs a Worker. jsdom provides neither, so both stubs have to
// exist before every test. Tests that assert on them pull the instance back out
// via latestAudioContext() / latestWorker().
beforeEach(() => {
  installAudioStub()
  installWorkerStub()
})

// Testing Library only auto-registers its cleanup when the test framework's
// globals are exposed, and this project runs with `globals: false`. Without
// this, mounted trees stack up in document.body and queries start matching
// elements left behind by earlier tests.
afterEach(() => {
  cleanup()
})
```

- [ ] **Step 4: Verify the worker typechecks and nothing regressed**

Run: `npx tsc -b && npx vitest run src/hook/useBeep.test.ts`
Expected: tsc exits 0; useBeep tests still pass (10).

- [ ] **Step 5: Commit**

```bash
git add src/worker/scheduler.worker.ts src/test/workerStub.ts src/test/setup.ts
git commit -m "feat(worker): add scheduler heartbeat worker and drivable test stub"
```

---

### Task 3: Scheduler core — exact beat spacing on the audio clock

**Files:**
- Create: `src/hook/useBeatScheduler.ts`
- Test: `src/hook/useBeatScheduler.test.ts`

**Interfaces:**
- Consumes: `useBeep()` from Task 1 (`scheduleBeep`, `audioTime`, `resumeAudio`); `latestWorker()` from Task 2.
- Produces: `useBeatScheduler({bpm, pattern, sound, running, onBeat}): { resumeAudio(): Promise<void> }`, where `onBeat: (beat: number, accent: boolean) => void`. `onBeat` is accepted now but not yet called — Task 5 delivers beats to it.

**Scope note:** this task schedules audio and nothing else. Cancelling committed notes is Task 4; delivering beats to the UI is Task 5. Do not implement them early — each has its own failing test first.

- [ ] **Step 1: Write the failing tests**

Create `src/hook/useBeatScheduler.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useBeatScheduler from './useBeatScheduler'
import { latestAudioContext } from '../test/audioStub'
import { latestWorker } from '../test/workerStub'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

type Options = Parameters<typeof useBeatScheduler>[0]

// MUST be awaited. The hook awaits resumeAudio() before it schedules anything,
// so the first beats are committed on a microtask. `vi.advanceTimersByTime(0)`
// does NOT flush microtasks -- only an async act() does. Getting this wrong
// makes every scheduling assertion race the scheduler and fail intermittently.
async function mount(overrides: Partial<Options> = {}) {
  const onBeat = vi.fn()
  const props: Options = {
    bpm: 120,
    pattern: 4,
    sound: true,
    running: true,
    onBeat,
    ...overrides,
  }
  const view = renderHook((p: Options) => useBeatScheduler(p), {
    initialProps: props,
  })
  await act(async () => {})
  return { ...view, onBeat }
}

/** Audio-clock times passed to osc.start(), in scheduling order. */
function scheduledTimes(): number[] {
  return latestAudioContext().oscillators.map(
    (osc) => osc.start.mock.calls[0][0] as number,
  )
}

describe('useBeatScheduler', () => {
  it('starts the worker heartbeat when running', async () => {
    await mount()

    expect(latestWorker().posted).toContainEqual({
      type: 'start',
      interval: 25,
    })
  })

  it('schedules beats exactly 60/bpm apart on the audio clock', async () => {
    // 132bpm = 0.4545...s per beat, deliberately not a round number.
    await mount({ bpm: 132 })
    const ctx = latestAudioContext()

    // Walk the audio clock forward, ticking as a real worker would.
    for (let i = 1; i <= 20; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    const times = scheduledTimes()
    expect(times.length).toBeGreaterThan(8)

    const expected = 60 / 132
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeCloseTo(expected, 9)
    }
  })

  it('accents the first beat of a run and every pattern-th beat after', async () => {
    await mount({ bpm: 240, pattern: 4 })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 12; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    // 880Hz marks an accent, 440Hz an offbeat.
    const freqs = ctx.oscillators.map((osc) => osc.frequency.value)
    expect(freqs.length).toBeGreaterThanOrEqual(8)
    freqs.slice(0, 8).forEach((f, i) => {
      expect(f).toBe(i % 4 === 0 ? 880 : 440)
    })
  })

  it('follows the pattern length for accent placement', async () => {
    await mount({ bpm: 240, pattern: 3 })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 12; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    const freqs = ctx.oscillators.map((osc) => osc.frequency.value)
    freqs.slice(0, 6).forEach((f, i) => {
      expect(f).toBe(i % 3 === 0 ? 880 : 440)
    })
  })

  it('schedules no audio when sound is muted', async () => {
    await mount({ sound: false })
    const ctx = latestAudioContext()

    for (let i = 1; i <= 8; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }

    expect(ctx.oscillators).toHaveLength(0)
  })

  it('picks up a tempo change on the next scheduled beat', async () => {
    const { rerender, onBeat } = await mount({ bpm: 120 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 0.5
      latestWorker().tick()
    })
    const before = scheduledTimes().length

    rerender({ bpm: 240, pattern: 4, sound: true, running: true, onBeat })

    act(() => {
      ctx.currentTime = 2
      latestWorker().tick()
    })

    const times = scheduledTimes()
    const gap = times[times.length - 1] - times[times.length - 2]
    expect(before).toBeGreaterThan(0)
    expect(gap).toBeCloseTo(60 / 240, 9)
  })

  it('does not schedule anything while stopped', async () => {
    await mount({ running: false })

    expect(latestAudioContext().oscillators).toHaveLength(0)
  })

  it('tells the worker to stop and terminates it', async () => {
    const { rerender, onBeat } = await mount()
    const worker = latestWorker()

    rerender({ bpm: 120, pattern: 4, sound: true, running: false, onBeat })

    expect(worker.posted).toContainEqual({ type: 'stop' })
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('restarts from an accented downbeat after stop', async () => {
    const { rerender, onBeat } = await mount({ bpm: 240, pattern: 4 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 0.5
      latestWorker().tick()
    })

    rerender({ bpm: 240, pattern: 4, sound: true, running: false, onBeat })

    const beforeRestart = ctx.oscillators.length
    rerender({ bpm: 240, pattern: 4, sound: true, running: true, onBeat })
    await act(async () => {})

    const firstAfterRestart = ctx.oscillators[beforeRestart]
    expect(firstAfterRestart.frequency.value).toBe(880)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hook/useBeatScheduler.test.ts`
Expected: FAIL — cannot resolve `./useBeatScheduler`.

- [ ] **Step 3: Implement scheduling**

Create `src/hook/useBeatScheduler.ts`:

```ts
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
          scheduleBeep(nextNoteTime, accent)
        }

        nextNoteTime += secondsPerBeat
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hook/useBeatScheduler.test.ts`
Expected: PASS, 9 tests (this count grew to 14 during Task 3 review fixes; verify against the real file rather than this number).

- [ ] **Step 5: Commit**

```bash
git add src/hook/useBeatScheduler.ts src/hook/useBeatScheduler.test.ts
git commit -m "feat(scheduler): commit beats to the audio clock ahead of time"
```

---

### Task 4: Stop cancels beats already committed to the future

**Files:**
- Modify: `src/hook/useBeatScheduler.ts`
- Modify: `src/test/audioStub.ts`
- Test: `src/hook/useBeatScheduler.test.ts`

**Interfaces:**
- Consumes: `useBeatScheduler` from Task 3.
- Produces: no API change. Notes committed to the audio clock are actively stopped and disconnected when the scheduler halts.

**Why this is not already handled:** Task 3 terminates the worker on stop, which prevents *new* beats being scheduled. But beats already committed to the audio clock keep sounding — the audio hardware does not care that the worker is gone. They must be cancelled explicitly.

- [ ] **Step 1: Add `disconnect` to the oscillator stub**

`StubOscillator` has no `disconnect`, so the test below would fail on a missing method rather than on behaviour. In `src/test/audioStub.ts`, add it:

```ts
export class StubOscillator {
  type = ''
  frequency = new StubAudioParam()
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}
```

- [ ] **Step 2: Write the failing test**

Append inside the `describe` block in `src/hook/useBeatScheduler.test.ts`:

```ts
  it('cancels beats already scheduled into the future when stopped', async () => {
    const { rerender, onBeat } = await mount({ bpm: 60 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 1
      latestWorker().tick()
    })

    const committed = ctx.oscillators.length
    expect(committed).toBeGreaterThan(0)

    rerender({ bpm: 60, pattern: 4, sound: true, running: false, onBeat })

    // Every note the scheduler committed to must be actively cancelled --
    // otherwise it still sounds after Stop.
    ctx.oscillators.forEach((osc) => {
      expect(osc.stop).toHaveBeenCalledWith()
      expect(osc.disconnect).toHaveBeenCalled()
    })
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/hook/useBeatScheduler.test.ts -t "cancels beats"`
Expected: FAIL — `scheduleBeep` called `osc.stop(when + 0.1)` with an argument, but never with no arguments, and `disconnect` was never called.

- [ ] **Step 4: Track and cancel committed notes**

In `src/hook/useBeatScheduler.ts`, inside the `running` effect, add the tracking array next to the other loop state:

```ts
    let worker: Worker | null = null

    const scheduled: OscillatorNode[] = []
    let nextNoteTime = 0
    let beat = 0
```

Capture each committed note in `scheduleAhead` — replace the muting block with:

```ts
        if (params.sound) {
          const osc = scheduleBeep(nextNoteTime, accent)
          if (osc) scheduled.push(osc)
        }
```

Then cancel them in the cleanup, after the worker teardown:

```ts
      // Beats are committed ahead of now, so without this they keep sounding
      // after the user hit Stop.
      for (const osc of scheduled) {
        try {
          osc.stop()
        } catch {
          // Already stopped or never started; nothing to undo.
        }
        osc.disconnect()
      }
      scheduled.length = 0
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/hook/useBeatScheduler.test.ts`
Expected: PASS. Task 3 review fixes grew the file well past the count written here, so verify against the real file rather than trusting a number.

- [ ] **Step 6: Commit**

```bash
git add src/hook/useBeatScheduler.ts src/hook/useBeatScheduler.test.ts src/test/audioStub.ts
git commit -m "fix(scheduler): cancel committed beats when the metronome stops"
```

---

### Task 5: Deliver beats to the UI, dropping stale ones

**Files:**
- Modify: `src/hook/useBeatScheduler.ts`
- Test: `src/hook/useBeatScheduler.test.ts`

**Interfaces:**
- Consumes: `useBeatScheduler` from Tasks 3–4.
- Produces: `onBeat(beat, accent)` is now called, on an rAF loop, at the moment each beat's audio time arrives.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block:

```ts
  it('reports a beat to the UI once its audio time has arrived', async () => {
    const { onBeat } = await mount({ bpm: 120, pattern: 4 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 0.2
      latestWorker().tick()
      vi.advanceTimersByTime(50)
    })

    expect(onBeat).toHaveBeenCalled()
    const [beat, accent] = onBeat.mock.calls[0]
    expect(beat).toBe(0)
    expect(accent).toBe(true)
  })

  it('does not report a beat before its audio time', async () => {
    const { onBeat } = await mount({ bpm: 60 })

    // currentTime stays at 0; the first beat is scheduled at START_OFFSET.
    act(() => {
      latestWorker().tick()
      vi.advanceTimersByTime(50)
    })

    expect(onBeat).not.toHaveBeenCalled()
  })

  it('releases notes that have finished sounding', async () => {
    // Guards against the committed-notes array growing for the whole run.
    // The array is private, but pruning is observable: a note already
    // finished must NOT be re-cancelled on stop, while a pending one must be.
    const { rerender, onBeat } = await mount({ bpm: 240, pattern: 4 })
    const ctx = latestAudioContext()

    act(() => {
      ctx.currentTime = 0.5
      latestWorker().tick()
    })

    const early = ctx.oscillators[0]
    expect(early).toBeDefined()

    // Advance past the first note's end and run a frame so the drain prunes.
    act(() => {
      ctx.currentTime = 5
      vi.advanceTimersByTime(20)
    })

    // Commit a fresh note that is still in the future, then stop.
    act(() => {
      latestWorker().tick()
    })
    const pending = ctx.oscillators[ctx.oscillators.length - 1]

    rerender({ bpm: 240, pattern: 4, sound: true, running: false, onBeat })

    expect(early.stop).not.toHaveBeenCalledWith()
    expect(pending.stop).toHaveBeenCalledWith()
  })

  it('drops stale beats instead of firing a burst after a hidden stretch', async () => {
    const { onBeat } = await mount({ bpm: 240, pattern: 4 })
    const ctx = latestAudioContext()

    // Build a REAL backlog. Ticking the worker commits beats, but the drain
    // only runs when timers advance -- so ticking without advancing lets the
    // queue accumulate exactly as it does while the tab is hidden and rAF is
    // parked. A single tick would queue one beat and prove nothing: the test
    // must be able to fail if the drain fires every due entry instead of the
    // last one.
    for (let i = 1; i <= 12; i++) {
      act(() => {
        ctx.currentTime = i * 0.25
        latestWorker().tick()
      })
    }
    expect(onBeat).not.toHaveBeenCalled()

    // Jump the audio clock past every queued beat, then run a single frame.
    act(() => {
      ctx.currentTime = 30
      vi.advanceTimersByTime(20)
    })

    // A dozen beats are due at once. Replaying them would machine-gun the UI.
    expect(onBeat.mock.calls.length).toBeLessThanOrEqual(2)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hook/useBeatScheduler.test.ts -t "reports a beat"`
Expected: FAIL — `onBeat` was never called; nothing delivers beats yet.

- [ ] **Step 3: Add the queue and the drain loop**

In `src/hook/useBeatScheduler.ts`, add the event type above `BeatSchedulerOptions`:

```ts
type BeatEvent = { time: number; beat: number; accent: boolean }
```

Inside the `running` effect, add the frame handle and queue to the loop state:

```ts
    let cancelled = false
    let frame = 0
    let worker: Worker | null = null

    const queue: BeatEvent[] = []
    const scheduled: OscillatorNode[] = []
    let nextNoteTime = 0
    let beat = 0
```

Queue every beat in `scheduleAhead`, immediately after the muting block and before `nextNoteTime` advances:

```ts
        queue.push({ time: nextNoteTime, beat, accent })
```

While you are here, fix a leak Task 4 left behind. `scheduled` is only ever appended to and is cleared solely in the effect cleanup, so a continuously-playing metronome retains every oscillator it has ever committed -- roughly 7,200 dead references per hour at 120bpm. The drain already walks the timeline, so it is the natural place to prune.

Change the tracking array to carry each note's end time. In `useBeep.ts`, export the note length so the scheduler does not duplicate the constant:

```ts
/** How long a single click rings, in seconds. */
export const NOTE_LENGTH = 0.1
```

In `useBeatScheduler.ts`, import it alongside the hook and change the array's element type:

```ts
import useBeep, { NOTE_LENGTH } from '@/hook/useBeep'
```

```ts
    const scheduled: { osc: OscillatorNode; endsAt: number }[] = []
```

Push the end time with each note:

```ts
        if (params.sound) {
          const osc = scheduleBeep(nextNoteTime, accent)
          if (osc) scheduled.push({ osc, endsAt: nextNoteTime + NOTE_LENGTH })
        }
```

And in the cleanup, unwrap before cancelling:

```ts
      for (const { osc } of scheduled) {
```

Add the drain loop after `scheduleAhead`:

```ts
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
```

Start it at the end of `begin`, after the first `scheduleAhead()`:

```ts
      scheduleAhead()
      frame = requestAnimationFrame(drain)
```

And stop it first in the cleanup:

```ts
      cancelled = true
      if (frame) cancelAnimationFrame(frame)
```

Finally clear the queue alongside the scheduled notes:

```ts
      scheduled.length = 0
      queue.length = 0
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hook/useBeatScheduler.test.ts`
Expected: PASS -- 3 more than the file had before this task (18 at time of writing).

If the drain never runs, confirm `vi.useFakeTimers()` is faking `requestAnimationFrame` — it is in Vitest 4's default `toFake` set. Do not switch the drain to `setTimeout`.

- [ ] **Step 5: Commit**

```bash
git add src/hook/useBeatScheduler.ts src/hook/useBeatScheduler.test.ts
git commit -m "feat(scheduler): deliver beats to the UI and drop stale ones"
```

---

### Task 6: Adaptive lookahead

**Files:**
- Modify: `src/hook/useBeatScheduler.ts`
- Test: `src/hook/useBeatScheduler.test.ts`

**Interfaces:**
- Consumes: `useBeatScheduler` from Task 3.
- Produces: no API change. Lookahead widens to 2s when `document.hidden` is true and returns to 0.1s when visible.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block:

```ts
  it('commits far more beats ahead while the tab is hidden', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)

    const { onBeat } = await mount({ bpm: 120 })
    expect(onBeat).not.toHaveBeenCalled()

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      latestWorker().tick()
    })

    // A 2s lookahead at 120bpm is about four beats; a 0.1s one is a single beat.
    expect(latestAudioContext().oscillators.length).toBeGreaterThanOrEqual(4)
    hidden.mockRestore()
  })

  it('commits only the next beat or so while visible', async () => {
    await mount({ bpm: 120 })

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      latestWorker().tick()
    })

    expect(latestAudioContext().oscillators.length).toBeLessThanOrEqual(2)
  })
```

- [ ] **Step 2: Run the tests to verify the hidden case fails**

Run: `npx vitest run src/hook/useBeatScheduler.test.ts -t "hidden"`
Expected: FAIL — only 1 oscillator, because the lookahead is still fixed at 0.1s.

- [ ] **Step 3: Implement the visibility listener**

First add the hidden-tab lookahead constant, immediately after `LOOKAHEAD_VISIBLE`. It is introduced here rather than in Task 3 because this is the first task that consumes it — declaring it earlier trips `noUnusedLocals`, and exporting it purely to satisfy the compiler would widen the module's public surface for no reason:

```ts
/** How far ahead while hidden -- must outlast throttled timers. */
const LOOKAHEAD_HIDDEN = 2
```

Then, immediately after the `lookaheadRef` declaration, insert:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hook/useBeatScheduler.test.ts`
Expected: PASS -- 2 more than the file had before this task (20 at time of writing).

- [ ] **Step 5: Commit**

```bash
git add src/hook/useBeatScheduler.ts src/hook/useBeatScheduler.test.ts
git commit -m "feat(scheduler): widen the lookahead only while the tab is hidden"
```

---

### Task 7: Wire up App and retire `useTimer`

**Files:**
- Modify: `src/App.tsx:1-63`
- Delete: `src/hook/useTimer.ts`, `src/hook/useTimer.test.ts`
- Test: `src/App.test.tsx` (existing, should pass unchanged)

**Interfaces:**
- Consumes: `useBeatScheduler` from Tasks 3–6.

- [ ] **Step 1: Replace the timer wiring in App**

In `src/App.tsx`, replace lines 1–63 (imports through the end of the second `useEffect`) with:

```tsx
import { useCallback, useRef, useState } from 'react'
import { useLocalStorage } from 'react-use'
import useBeatScheduler from '@/hook/useBeatScheduler'
import useVibrate from '@/hook/useVibrate'
import Blip from '@/com/Blip'

import './App.css'
import logo from './img/logo96.png'


export default function App() {
  const [bpm, setBpm] = useLocalStorage('bpm', 120)
  const [pattern, setPattern] = useLocalStorage('pattern', 4)
  const [sound, setSound] = useLocalStorage('sound', true)
  const [vibe, setVibe] = useLocalStorage('vibe', false)

  const [accent, setAccent] = useState(false)
  const [running, setRunning] = useState(false)
  const [tick, setTick] = useState(false)

  const vibrate = useVibrate()
  const blipTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const vibeRef = useRef(vibe)
  vibeRef.current = vibe

  const onBeat = useCallback(
    (_beat: number, accented: boolean) => {
      setTick(true)
      setAccent(accented)
      if (vibeRef.current) vibrate(accented)

      clearTimeout(blipTimeout.current)
      blipTimeout.current = setTimeout(() => {
        setTick(false)
      }, 100)
    },
    [vibrate],
  )

  useBeatScheduler({
    bpm: bpm ?? 120,
    pattern: pattern ?? 4,
    sound: sound ?? true,
    running,
    onBeat,
  })
```

- [ ] **Step 2: Fix the ref-during-render violation**

`vibeRef.current = vibe` above is written during render, which `react-hooks/refs` rejects — the same defect fixed in `useTimer` earlier. Replace those two lines with an effect. Change the import to include `useEffect`, then replace:

```tsx
  const vibeRef = useRef(vibe)
  vibeRef.current = vibe
```

with:

```tsx
  const vibeRef = useRef(vibe)
  useEffect(() => {
    vibeRef.current = vibe
  }, [vibe])
```

Import line becomes:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
```

- [ ] **Step 3: Delete `useTimer`**

```bash
git rm src/hook/useTimer.ts src/hook/useTimer.test.ts
```

- [ ] **Step 4: Run the whole suite, lint and build**

Run: `npm test`
Expected: PASS, and this is the first task where the FULL suite must be green. useTimer's 12 tests are gone; useBeep has 10, useVibrate 4, App 8, and useBeatScheduler around 20 -- it grew during Task 3 and 4 review fixes. Verify the real total rather than a number written before those fixes.

Run: `npm run lint`
Expected: exit 0. If `react-hooks/refs` still fires, a ref is being written during render somewhere in App.

Run: `npm run build`
Expected: exit 0, and the asset list includes `assets/scheduler.worker-<hash>.js`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(app): drive the metronome from the audio-clock scheduler"
```

---

### Task 8: Verify the built artifact, not just the tests

**Files:** none modified.

- [ ] **Step 1: Confirm the worker is precached**

```bash
npm run build
grep -o 'url:"assets/scheduler.worker[^"]*"' dist/sw.js
```

Expected: one match. If empty, the worker chunk is not in the precache manifest and the app breaks offline — stop and investigate before merging.

- [ ] **Step 2: Confirm the base path is baked in**

```bash
grep -o '/metronome/assets/scheduler.worker[^"`]*' dist/assets/index-*.js | head -1
```

Expected: one match beginning `/metronome/assets/scheduler.worker-`. A bare `/assets/...` means the worker 404s on GitHub Pages.

- [ ] **Step 3: Serve and smoke-test**

```bash
npm run preview
```

Then in another shell:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/metronome/
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4173/metronome/$(grep -o 'assets/scheduler.worker-[A-Za-z0-9_-]*\.js' dist/sw.js | head -1)"
```

Expected: `200` for both. Stop the preview server afterwards.

- [ ] **Step 4: Manual check in a real browser**

The automated tests use a stubbed Worker and a stubbed AudioContext, so neither the real worker nor real audio has ever run. This step is the only thing that exercises them.

1. `npm run dev`, open the app.
2. Press Start. Confirm you hear a click and see the blip.
3. Set BPM to 132. Confirm the tempo changes within a beat or so — not after a 2s delay.
4. Switch to another tab for ~20 seconds. Confirm the clicking continues.
5. Switch back. Confirm the blip resumes and does **not** machine-gun to catch up.
6. Press Stop. Confirm the clicking stops immediately, with no trailing beats.
7. Mute sound, press Start. Confirm the blip still pulses with no audio.

- [ ] **Step 5: Commit**

Nothing to commit unless a defect was found. If all checks pass, record the verification in the final report rather than fabricating a commit.

---

## Self-Review

**Spec coverage:** Worker (Task 2), `scheduleBeep` at absolute time (Task 1), lookahead loop and beat phase (Task 3), private queue and rAF drain (Task 5), `onBeat` to App (Task 7), stop cancels the future (Task 4), adaptive lookahead (Task 6), mute does not pause the beat (Task 3 proves no audio is scheduled; Task 5 proves beats are still delivered), start resets phase to an accented downbeat (Task 3), pattern change does not reset phase (Task 3 covers pattern length; phase continuity is inherent — the effect does not restart on pattern change), `workerStub.ts` mirroring `audioStub.ts` (Task 2), exact `n × 60/bpm` spacing (Task 3), worker build and precache risk (Task 8), `useTimer` retired (Task 7).

**Placeholders:** none. Every code step carries complete code.

**Type consistency:** `scheduleBeep(when, accent?)` returns `OscillatorNode | null` in Task 1; Task 3 calls it for its side effect and Task 4 starts consuming the return value. `audioTime()` returns `number`. `onBeat(beat: number, accent: boolean)` matches between Task 3's type, Task 5's assertions, and Task 7's `useCallback`. `StubWorker.tick()` and `latestWorker()` from Task 2 are used in Tasks 3–6. `StubOscillator.disconnect` is added in Task 4 Step 1, before the Task 4 test that needs it.

**Test-count chain:** Task 3 leaves 9 scheduler tests, Task 4 makes 10, Task 5 makes 13, Task 6 makes 15. With useBeep 10, useVibrate 4 and App 8, the suite finishes at 37 once `useTimer`'s 12 retire in Task 7.

**Every task has a real red phase.** Tasks 3, 4 and 5 were originally one implementation plus two test-only follow-ups, which meant Tasks 4 and 5 asserted against code that already existed — test-after, not TDD, and in conflict with the repo's red/green mandate. Task 3 now implements scheduling only; the cancellation path and the rAF drain each begin from a failing test in their own task. Do not collapse them back: an implementer who writes the drain during Task 3 destroys Task 5's red phase.

**Known deviation, deliberate:** Task 7 Step 1 shows a ref written during render and Step 2 immediately corrects it. That is intentional — the violation is the single most likely mistake here, having already occurred once in this codebase, so the plan walks the implementer through it rather than silently presenting the fixed version.
