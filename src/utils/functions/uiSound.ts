// Tab Keeper's one sound, made in code: the floppy's shutter click.

const LEVEL = 0.3;
const Q = 4;
const ATTACK_S = 0.002;
const SILENT = 0.0001;
// Two band-passed noise ticks: a low one, then a brighter one at half the level.
const TICKS = [
  { at: 0, hz: 3200, length: 0.05, peak: LEVEL },
  { at: 0.035, hz: 5200, length: 0.035, peak: LEVEL / 2 },
] as const;
const NOISE_S = Math.max(...TICKS.map((tick) => tick.length));

let audio: { context: AudioContext; noise: AudioBuffer } | null = null;

// One context for the page, made on the first play; throws where the page has no Web Audio.
function openAudio(): { context: AudioContext; noise: AudioBuffer } {
  if (audio !== null) return audio;
  const context = new AudioContext();
  const noise = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * NOISE_S),
    context.sampleRate
  );
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1)
    samples[i] = Math.random() * 2 - 1;
  audio = { context, noise };
  return audio;
}

// A sound is never worth an error: anything Web Audio refuses plays nothing.
export function playShutterClick(): void {
  try {
    const { context, noise } = openAudio();
    if (context.state === 'suspended') void context.resume().catch(() => {});
    const now = context.currentTime;
    for (const tick of TICKS) {
      const start = now + tick.at;
      const end = start + tick.length;
      const source = context.createBufferSource();
      source.buffer = noise;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = tick.hz;
      filter.Q.value = Q;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(tick.peak, start + ATTACK_S);
      gain.gain.exponentialRampToValueAtTime(SILENT, end);
      source.connect(filter).connect(gain).connect(context.destination);
      source.start(start);
      source.stop(end);
    }
  } catch {
    // Nothing to tell the user: the press still does what it does.
  }
}
