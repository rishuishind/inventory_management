let audio: AudioContext | null = null

/** Short beep so the cashier hears whether a scan worked without looking at the screen. */
export function beep(kind: 'ok' | 'error' = 'ok'): void {
  try {
    audio ??= new AudioContext()
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = kind === 'ok' ? 'sine' : 'square'
    osc.frequency.value = kind === 'ok' ? 1250 : 220
    gain.gain.value = kind === 'ok' ? 0.12 : 0.06
    osc.connect(gain).connect(audio.destination)
    const t = audio.currentTime
    osc.start(t)
    osc.stop(t + (kind === 'ok' ? 0.07 : 0.3))
  } catch {
    // No sound device: nothing to do.
  }
}
