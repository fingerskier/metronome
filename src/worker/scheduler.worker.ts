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
