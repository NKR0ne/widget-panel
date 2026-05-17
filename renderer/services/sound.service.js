let audioCtx = null;
let lastHoverFocusAt = 0;

const SOUND_ENABLED = true;
const MASTER_GAIN = 0.032;

function getAudioContext() {
  if (!SOUND_ENABLED) return null;
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!audioCtx) audioCtx = new AudioCtor();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function makeOutput(ctx, t0, duration, gain) {
  const output = ctx.createGain();
  const delay = ctx.createDelay(0.12);
  const feedback = ctx.createGain();
  const wet = ctx.createGain();

  output.gain.setValueAtTime(0.0001, t0);
  output.gain.exponentialRampToValueAtTime(MASTER_GAIN * gain, t0 + 0.003);
  output.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  delay.delayTime.setValueAtTime(0.034, t0);
  feedback.gain.setValueAtTime(0.16, t0);
  wet.gain.setValueAtTime(0.24, t0);

  output.connect(ctx.destination);
  output.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(ctx.destination);

  return output;
}

function addGlassTick(ctx, t0, destination, gain) {
  const frames = Math.max(1, Math.floor(ctx.sampleRate * 0.018));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    const envelope = 1 - (i / frames);
    data[i] = (Math.random() * 2 - 1) * envelope * envelope;
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const amp = ctx.createGain();

  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(5200, t0);
  filter.Q.setValueAtTime(5.5, t0);
  amp.gain.setValueAtTime(0.018 * gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.028);

  source.buffer = buffer;
  source.connect(filter);
  filter.connect(amp);
  amp.connect(destination);
  source.start(t0);
  source.stop(t0 + 0.03);
}

function crystalClink({ base = 1760, delay = 0, duration = 0.62, gain = 1, down = false }) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const t0 = ctx.currentTime + delay;
  const output = makeOutput(ctx, t0, duration, gain);
  const ratios = [1, 2.01, 2.74, 3.92, 5.43, 6.81];
  const levels = [1, 0.42, 0.24, 0.14, 0.075, 0.045];

  addGlassTick(ctx, t0, output, gain);

  ratios.forEach((ratio, index) => {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const partialDuration = duration * (1 - index * 0.075);
    const frequency = base * ratio;
    const drift = down ? 0.997 : 1.003;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, t0);
    osc.frequency.exponentialRampToValueAtTime(frequency * drift, t0 + partialDuration);

    filter.type = 'highpass';
    filter.frequency.setValueAtTime(980, t0);
    filter.Q.setValueAtTime(0.6, t0);

    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(levels[index], t0 + 0.004 + index * 0.001);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + partialDuration);

    osc.connect(amp);
    amp.connect(filter);
    filter.connect(output);
    osc.start(t0);
    osc.stop(t0 + partialDuration + 0.03);
  });
}

export function playCardExpandSound() {
  crystalClink({ base: 1568, duration: 0.54, gain: 0.72 });
  crystalClink({ base: 2093, delay: 0.045, duration: 0.44, gain: 0.26 });
}

export function playCardCollapseSound() {
  crystalClink({ base: 1397, duration: 0.40, gain: 0.48, down: true });
}

export function playPanelInSound() {
  crystalClink({ base: 1175, duration: 0.58, gain: 0.38 });
  crystalClink({ base: 1760, delay: 0.08, duration: 0.50, gain: 0.25 });
}

export function playPanelOutSound() {
  crystalClink({ base: 1760, duration: 0.42, gain: 0.30, down: true });
  crystalClink({ base: 1175, delay: 0.045, duration: 0.36, gain: 0.18, down: true });
}

export function playHoverFocusSound() {
  const now = performance.now();
  if (now - lastHoverFocusAt < 140) return;
  lastHoverFocusAt = now;

  const ctx = getAudioContext();
  if (!ctx) return;

  const t0 = ctx.currentTime;
  const output = makeOutput(ctx, t0, 0.13, 0.16);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  addGlassTick(ctx, t0, output, 0.22);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(2637, t0);
  osc.frequency.exponentialRampToValueAtTime(2668, t0 + 0.11);

  filter.type = 'highpass';
  filter.frequency.setValueAtTime(1800, t0);

  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(0.105, t0 + 0.003);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);

  osc.connect(amp);
  amp.connect(filter);
  filter.connect(output);
  osc.start(t0);
  osc.stop(t0 + 0.14);
}
