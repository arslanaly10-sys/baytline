/**
 * Ambient sound for the film, synthesized in the browser (no audio files):
 * a soft desert wind, joined by a low city hum as night falls.
 * Off by default; only starts from the visitor's own click (browsers require a gesture anyway).
 */
export class AmbientSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private sources: AudioScheduledSourceNode[] = [];

  private noiseBuffer(ctx: AudioContext, seconds: number) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // Brown noise: integrated white noise, soft and low.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    return buf;
  }

  start() {
    if (this.ctx) {
      void this.ctx.resume();
      this.fadeTo(0.55);
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Wind: brown noise through a slowly sweeping low-pass filter.
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuffer(ctx, 6);
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "lowpass";
    this.windFilter.frequency.value = 420;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 180;
    lfo.connect(lfoDepth).connect(this.windFilter.frequency);
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // City hum: band-passed noise plus a faint low tone, faded in by nightfall.
    const hum = ctx.createBufferSource();
    hum.buffer = this.noiseBuffer(ctx, 4);
    hum.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 160;
    band.Q.value = 0.8;
    const tone = ctx.createOscillator();
    tone.frequency.value = 55;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0.04;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    hum.connect(band).connect(this.humGain);
    tone.connect(toneGain).connect(this.humGain);
    this.humGain.connect(this.master);

    [wind, lfo, hum, tone].forEach((s) => s.start());
    this.sources = [wind, lfo, hum, tone];
    this.fadeTo(0.55);
  }

  private fadeTo(level: number) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(level, now, 0.6);
  }

  stop() {
    this.fadeTo(0);
    const ctx = this.ctx;
    if (ctx) setTimeout(() => void ctx.suspend(), 1500);
  }

  /** 0 = daytime wind, 1 = night: wind softens, city hum rises. */
  setNight(n: number) {
    if (!this.ctx || !this.windGain || !this.humGain || !this.windFilter) return;
    const now = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.5 - n * 0.25, now, 0.5);
    this.humGain.gain.setTargetAtTime(n * 0.35, now, 0.5);
  }

  dispose() {
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    void this.ctx?.close();
    this.ctx = null;
  }
}
