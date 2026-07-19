import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { installAudioStub } from './audioStub'

// Anything that mounts App or useBeep builds an AudioContext on mount, so the
// stub has to exist before every test. Tests that assert on audio pull the
// instance back out via latestAudioContext().
beforeEach(() => {
  installAudioStub()
})

// Testing Library only self-registers its cleanup when the test framework's
// globals are exposed, and this project runs with `globals: false`. Without
// this, mounted trees stack up in document.body and queries start matching
// elements left behind by earlier tests.
afterEach(() => {
  cleanup()
})
