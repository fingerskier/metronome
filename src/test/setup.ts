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
