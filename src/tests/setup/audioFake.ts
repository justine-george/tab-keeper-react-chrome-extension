// A fake Web Audio graph for jsdom, which has none: each source keeps its filter, gain and schedule.

export type Automation = { method: string; value: number; time: number };

class FakeParam {
  value = 0;
  readonly log: Automation[] = [];
  setValueAtTime(value: number, time: number) {
    this.log.push({ method: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.log.push({ method: 'linear', value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.log.push({ method: 'exponential', value, time });
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  output: unknown = null;
  connect<T>(node: T): T {
    this.output = node;
    return node;
  }
}

class FakeFilter {
  type = '';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  output: FakeGain | null = null;
  connect(node: FakeGain): FakeGain {
    this.output = node;
    return node;
  }
}

export class FakeSource {
  buffer: unknown = null;
  output: FakeFilter | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  connect(node: FakeFilter): FakeFilter {
    this.output = node;
    return node;
  }
  start(when: number) {
    this.startedAt = when;
  }
  stop(when: number) {
    this.stoppedAt = when;
  }
}

// The current test's record; a context the app kept from an earlier test still writes here.
const heard: {
  sources: FakeSource[];
  contexts: { resumed: number; destination: object }[];
} = { sources: [], contexts: [] };

// Installed as the page's AudioContext; the app builds it with `new AudioContext()`.
export function installFakeAudio(state: AudioContextState = 'running') {
  heard.sources = [];
  heard.contexts = [];
  class FakeAudioContext {
    currentTime = 2;
    sampleRate = 48000;
    state = state;
    destination = { name: 'speakers' };
    resumed = 0;
    constructor() {
      heard.contexts.push(this);
    }
    resume() {
      this.resumed += 1;
      return Promise.resolve();
    }
    createBuffer(_channels: number, length: number) {
      const data = new Float32Array(length);
      return { length, getChannelData: () => data };
    }
    createBufferSource() {
      const source = new FakeSource();
      heard.sources.push(source);
      return source;
    }
    createBiquadFilter() {
      return new FakeFilter();
    }
    createGain() {
      return new FakeGain();
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  });
  return heard;
}

export function uninstallFakeAudio(): void {
  Reflect.deleteProperty(globalThis, 'AudioContext');
}

// When each tick of every click so far starts, in seconds of the context's clock.
export const startedTicks = (): (number | null)[] =>
  heard.sources.map((s) => s.startedAt);
