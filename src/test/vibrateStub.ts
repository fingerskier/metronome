import { vi } from 'vitest'

/**
 * jsdom ships no Vibration API at all -- `'vibrate' in navigator` is false and
 * calling it throws. Tests that care about haptics install this spy and remove
 * it again; `restoreMocks` does not undo a defineProperty, so removal has to be
 * explicit.
 *
 * The default impl returns true, matching a user agent that accepted the
 * pattern. Pass `() => false` to model a refusal (hidden document, no
 * vibrator, permissions policy).
 */
export function installVibrateStub(
  impl: (pattern: number | number[]) => boolean | undefined = () => true,
) {
  const vibrate = vi.fn(impl)
  Object.defineProperty(navigator, 'vibrate', {
    value: vibrate,
    configurable: true,
    writable: true,
  })
  return vibrate
}

export function removeVibrateStub() {
  Reflect.deleteProperty(navigator, 'vibrate')
}

/** Every array-valued call, in order -- i.e. the batches, ignoring cancels. */
export function issuedPatterns(
  vibrate: ReturnType<typeof installVibrateStub>,
): number[][] {
  return vibrate.mock.calls
    .map(([pattern]) => pattern)
    .filter((pattern): pattern is number[] => Array.isArray(pattern))
}
