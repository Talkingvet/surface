let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/** Soft mechanical-keyboard-style tick for typing. */
export function playKeyClick(): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;

  // short filtered noise burst
  const len = Math.floor(ac.sampleRate * 0.03);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource();
  src.buffer = buf;

  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400 + Math.random() * 600; // slight variation per keystroke
  bp.Q.value = 1.4;

  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.10, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

  src.connect(bp).connect(gain).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.035);
}

/** Gentle two-note chime when a task is completed. */
export function playComplete(): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const notes: [number, number][] = [
    [660, 0],
    [880, 0.09],
  ];
  for (const [freq, offset] of notes) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.07, t + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.22);
    osc.connect(gain).connect(ac.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.25);
  }
}
