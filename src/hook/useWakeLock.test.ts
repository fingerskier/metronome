import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import useWakeLock from './useWakeLock'
import {
  installWakeLockStub,
  removeWakeLockStub,
  setVisibility,
} from '../test/wakeLockStub'

afterEach(() => {
  removeWakeLockStub()
})

/** Mounts the hook and flushes the microtask the request() promise lands on. */
async function mount(active = true) {
  const view = renderHook(({ on }: { on: boolean }) => useWakeLock(on), {
    initialProps: { on: active },
  })
  await act(async () => {})
  return view
}

describe('useWakeLock', () => {
  it('requests a screen wake lock while active', async () => {
    const wakeLock = installWakeLockStub()

    await mount()

    expect(wakeLock.request).toHaveBeenCalledWith('screen')
  })

  it('requests nothing while inactive', async () => {
    const wakeLock = installWakeLockStub()

    await mount(false)

    expect(wakeLock.request).not.toHaveBeenCalled()
  })

  it('releases the sentinel when it goes inactive', async () => {
    const wakeLock = installWakeLockStub()
    const { rerender } = await mount()
    const sentinel = wakeLock.latest

    rerender({ on: false })

    expect(sentinel?.release).toHaveBeenCalled()
  })

  it('releases the sentinel on unmount', async () => {
    const wakeLock = installWakeLockStub()
    const { unmount } = await mount()
    const sentinel = wakeLock.latest

    unmount()

    expect(sentinel?.release).toHaveBeenCalled()
  })

  it('releases a sentinel that resolves after teardown', async () => {
    // The classic effect race: request() is in flight when the effect is torn
    // down, so the cleanup has nothing to release and the lock would otherwise
    // be held forever with no handle to it.
    const wakeLock = installWakeLockStub()
    wakeLock.deferred = true

    const { unmount } = renderHook(() => useWakeLock(true))
    unmount()

    await act(async () => {
      wakeLock.settle()
    })

    expect(wakeLock.latest?.release).toHaveBeenCalled()
  })

  it('swallows a rejected request', async () => {
    // request() rejects with NotAllowedError on an insecure context, under a
    // restrictive permissions policy, or if the page hides mid-flight. None of
    // those deserve a crash -- the app simply behaves as it does today.
    const wakeLock = installWakeLockStub()
    wakeLock.failure = new Error('NotAllowedError')

    await expect(mount()).resolves.toBeDefined()
  })

  it('is a no-op where navigator.wakeLock is absent', async () => {
    // iOS Safari before 16.4, and every browser on an insecure origin.
    removeWakeLockStub()

    await expect(mount()).resolves.toBeDefined()
  })

  it('does not request while the document is hidden', async () => {
    // The spec has request() reject outright while hidden, so asking is pure
    // noise -- the visibilitychange handler is the recovery path.
    const wakeLock = installWakeLockStub()
    setVisibility('hidden')

    await mount()

    expect(wakeLock.request).not.toHaveBeenCalled()
  })

  it('re-acquires when the page becomes visible after the user agent released the lock', async () => {
    // A wake lock does not survive the page being hidden: the user agent
    // releases it and never restores it. Without this the metronome comes back
    // to the foreground with the screen free to sleep again.
    const wakeLock = installWakeLockStub()
    setVisibility('visible')
    await mount()
    expect(wakeLock.request).toHaveBeenCalledTimes(1)

    await act(async () => {
      wakeLock.latest?.fireRelease()
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(wakeLock.request).toHaveBeenCalledTimes(1)

    await act(async () => {
      setVisibility('visible')
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(wakeLock.request).toHaveBeenCalledTimes(2)
  })

  it('does not stack a second lock when it already holds one', async () => {
    const wakeLock = installWakeLockStub()
    setVisibility('visible')
    await mount()

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(wakeLock.request).toHaveBeenCalledTimes(1)
  })
})
