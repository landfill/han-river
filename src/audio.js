// Synthesized ambience: no external recording or hidden autoplay.
export class RiverAudio {
  constructor() {
    this.enabled = false;
    this.volume = 0.35;
    this.ctx = null;
  }
  async toggle() {
    if (!this.ctx) this.init();
    await this.ctx.resume();
    this.enabled = !this.enabled;
    this.applyVolume();
    return this.enabled;
  }
  init() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('이 브라우저에서는 주변 소리를 사용할 수 없어요.');
    this.ctx = new AudioContext();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0;
    this.master.connect(c.destination);
    const buffer = c.createBuffer(1, c.sampleRate * 6, c.sampleRate),
      data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + Math.random() * 0.04 - 0.02) / 1.012;
      data[i] = last * 5;
    }
    const noise = c.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    this.water = c.createGain();
    this.water.gain.value = 0.15;
    noise.connect(filter).connect(this.water).connect(this.master);
    noise.start();
    const windFilter = c.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 420;
    windFilter.Q.value = 0.3;
    const wind = c.createGain();
    wind.gain.value = 0.1;
    noise.connect(windFilter).connect(wind).connect(this.master);
    const lfo = c.createOscillator(),
      swell = c.createGain();
    lfo.frequency.value = 0.13;
    swell.gain.value = 0.045;
    lfo.connect(swell).connect(this.water.gain);
    lfo.start();
    this.engine = c.createGain();
    this.engine.gain.value = 0.025;
    this.engine.connect(this.master);
    for (const f of [48, 72, 96]) {
      const osc = c.createOscillator(),
        gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.value = 0.3;
      osc.connect(gain).connect(this.engine);
      osc.start();
    }
  }
  applyVolume() {
    if (this.ctx)
      this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.2);
  }
  setVolume(value) {
    this.volume = value;
    this.applyVolume();
  }
  update(speed) {
    if (this.ctx) this.engine.gain.setTargetAtTime(0.012 + speed * 0.04, this.ctx.currentTime, 0.5);
  }
}
