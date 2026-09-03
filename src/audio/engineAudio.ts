/**
 * Procedural Web Audio Engine Synthesizer, Turbocharger Whine, BOV Flutter, ABS Chatter, Rev-Limiter Spark Cuts, Kerb Rumble & Dogbox Gear Whine
 */

function safeFinite(val: number, fallback: number = 0): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function safeSetTarget(
  param: AudioParam | null | undefined,
  targetValue: number,
  startTime: number,
  timeConstant: number,
  fallback: number = 0
) {
  if (!param) return;
  const safeVal = safeFinite(targetValue, fallback);
  const safeTime = safeFinite(startTime, 0);
  const safeConst = Math.max(0.001, safeFinite(timeConstant, 0.02));
  try {
    param.setTargetAtTime(safeVal, safeTime, safeConst);
  } catch {
    try {
      param.value = safeVal;
    } catch {
      // ignore
    }
  }
}

function safeSetValue(
  param: AudioParam | null | undefined,
  value: number,
  startTime: number,
  fallback: number = 0
) {
  if (!param) return;
  const safeVal = safeFinite(value, fallback);
  const safeTime = safeFinite(startTime, 0);
  try {
    param.setValueAtTime(safeVal, safeTime);
  } catch {
    try {
      param.value = safeVal;
    } catch {
      // ignore
    }
  }
}

export class VehicleAudioSystem {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;
  private isInitialized: boolean = false;

  // Engine oscillators and gain nodes
  private masterGain: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private oscSub: OscillatorNode | null = null;
  private oscHarmonic1: OscillatorNode | null = null;
  private oscHarmonic2: OscillatorNode | null = null;
  private oscHarmonic3: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  // Turbocharger whine & boost
  private turboWhineOsc: OscillatorNode | null = null;
  private turboWhineGain: GainNode | null = null;
  private turboFilter: BiquadFilterNode | null = null;

  // Transmission straight-cut gear whine
  private gearWhineOsc: OscillatorNode | null = null;
  private gearWhineGain: GainNode | null = null;

  // Tire screech generator
  private tireNoiseNode: AudioBufferSourceNode | null = null;
  private tireNoiseGain: GainNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;

  // ABS Brake Chatter & Pulsing
  private absChatterOsc: OscillatorNode | null = null;
  private absChatterGain: GainNode | null = null;

  // Kerb Rumble Strip Vibration
  private kerbRumbleOsc: OscillatorNode | null = null;
  private kerbRumbleGain: GainNode | null = null;

  // Wind rush noise
  private windGain: GainNode | null = null;

  public init() {
    if (this.isInitialized) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      const t = safeFinite(this.ctx.currentTime, 0);

      // Master Gain
      this.masterGain = this.ctx.createGain();
      safeSetValue(this.masterGain.gain, 0.45, t, 0.45);
      this.masterGain.connect(this.ctx.destination);

      // --- Engine Synthesizer (V8 / Twin-Turbo Inline-6 Simulation) ---
      this.engineGain = this.ctx.createGain();
      safeSetValue(this.engineGain.gain, 0.35, t, 0.35);

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      safeSetValue(this.engineFilter.frequency, 450, t, 450);
      safeSetValue(this.engineFilter.Q, 2.2, t, 2.2);

      this.oscSub = this.ctx.createOscillator();
      this.oscSub.type = 'sawtooth';
      safeSetValue(this.oscSub.frequency, 40, t, 40);

      this.oscHarmonic1 = this.ctx.createOscillator();
      this.oscHarmonic1.type = 'triangle';
      safeSetValue(this.oscHarmonic1.frequency, 80, t, 80);

      this.oscHarmonic2 = this.ctx.createOscillator();
      this.oscHarmonic2.type = 'square';
      safeSetValue(this.oscHarmonic2.frequency, 120, t, 120);

      this.oscHarmonic3 = this.ctx.createOscillator();
      this.oscHarmonic3.type = 'sawtooth';
      safeSetValue(this.oscHarmonic3.frequency, 160, t, 160);

      const gainH2 = this.ctx.createGain();
      safeSetValue(gainH2.gain, 0.22, t, 0.22);
      this.oscHarmonic2.connect(gainH2);
      gainH2.connect(this.engineFilter);

      const gainH3 = this.ctx.createGain();
      safeSetValue(gainH3.gain, 0.18, t, 0.18);
      this.oscHarmonic3.connect(gainH3);
      gainH3.connect(this.engineFilter);

      this.oscSub.connect(this.engineFilter);
      this.oscHarmonic1.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.oscSub.start();
      this.oscHarmonic1.start();
      this.oscHarmonic2.start();
      this.oscHarmonic3.start();

      // --- Turbocharger Spool Whine Synthesizer ---
      this.turboWhineOsc = this.ctx.createOscillator();
      this.turboWhineOsc.type = 'sine';
      safeSetValue(this.turboWhineOsc.frequency, 800, t, 800);

      this.turboFilter = this.ctx.createBiquadFilter();
      this.turboFilter.type = 'bandpass';
      safeSetValue(this.turboFilter.frequency, 2400, t, 2400);
      safeSetValue(this.turboFilter.Q, 6.0, t, 6.0);

      this.turboWhineGain = this.ctx.createGain();
      safeSetValue(this.turboWhineGain.gain, 0.0001, t, 0.0001);

      this.turboWhineOsc.connect(this.turboFilter);
      this.turboFilter.connect(this.turboWhineGain);
      this.turboWhineGain.connect(this.masterGain);
      this.turboWhineOsc.start();

      // --- Dogbox Transmission Gear Whine ---
      this.gearWhineOsc = this.ctx.createOscillator();
      this.gearWhineOsc.type = 'triangle';
      safeSetValue(this.gearWhineOsc.frequency, 400, t, 400);

      this.gearWhineGain = this.ctx.createGain();
      safeSetValue(this.gearWhineGain.gain, 0.0001, t, 0.0001);

      this.gearWhineOsc.connect(this.gearWhineGain);
      this.gearWhineGain.connect(this.masterGain);
      this.gearWhineOsc.start();

      // --- Tire Screech Synthesizer (Filtered Pink Noise with Resonance) ---
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        output[i] *= 0.11;
        b6 = white * 0.115926;
      }

      this.tireNoiseNode = this.ctx.createBufferSource();
      this.tireNoiseNode.buffer = noiseBuffer;
      this.tireNoiseNode.loop = true;

      this.tireFilter = this.ctx.createBiquadFilter();
      this.tireFilter.type = 'bandpass';
      safeSetValue(this.tireFilter.frequency, 1100, t, 1100);
      safeSetValue(this.tireFilter.Q, 4.5, t, 4.5);

      this.tireNoiseGain = this.ctx.createGain();
      safeSetValue(this.tireNoiseGain.gain, 0.0001, t, 0.0001);

      this.tireNoiseNode.connect(this.tireFilter);
      this.tireFilter.connect(this.tireNoiseGain);
      this.tireNoiseGain.connect(this.masterGain);
      this.tireNoiseNode.start();

      // --- ABS Chatter Synthesizer ---
      this.absChatterOsc = this.ctx.createOscillator();
      this.absChatterOsc.type = 'square';
      safeSetValue(this.absChatterOsc.frequency, 16, t, 16); // 16Hz ABS pulse

      this.absChatterGain = this.ctx.createGain();
      safeSetValue(this.absChatterGain.gain, 0.0001, t, 0.0001);

      this.absChatterOsc.connect(this.absChatterGain);
      this.absChatterGain.connect(this.masterGain);
      this.absChatterOsc.start();

      // --- Kerb Rumble Strip Audio ---
      this.kerbRumbleOsc = this.ctx.createOscillator();
      this.kerbRumbleOsc.type = 'triangle';
      safeSetValue(this.kerbRumbleOsc.frequency, 32, t, 32);

      this.kerbRumbleGain = this.ctx.createGain();
      safeSetValue(this.kerbRumbleGain.gain, 0.0001, t, 0.0001);

      this.kerbRumbleOsc.connect(this.kerbRumbleGain);
      this.kerbRumbleGain.connect(this.masterGain);
      this.kerbRumbleOsc.start();

      // --- Wind Noise ---
      const windBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const windData = windBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        windData[i] = (Math.random() * 2 - 1) * 0.05;
      }
      const windSource = this.ctx.createBufferSource();
      windSource.buffer = windBuffer;
      windSource.loop = true;

      const windFilter = this.ctx.createBiquadFilter();
      windFilter.type = 'lowpass';
      safeSetValue(windFilter.frequency, 320, t, 320);

      this.windGain = this.ctx.createGain();
      safeSetValue(this.windGain.gain, 0.0001, t, 0.0001);

      windSource.connect(windFilter);
      windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);
      windSource.start();

      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio API not allowed or supported yet', e);
    }
  }

  public update(
    rpm: number,
    maxRpm: number,
    throttle: number,
    speedKmh: number,
    maxSkidIntensity: number,
    turboBoostPsi: number = 0,
    turboBlowOff: boolean = false,
    absActive: boolean = false,
    isRevLimiting: boolean = false,
    revCutBounce: boolean = false,
    kerbRumbleIntensity: number = 0
  ) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    const t = safeFinite(this.ctx.currentTime, 0);
    const validMaxRpm = Math.max(1000, safeFinite(maxRpm, 7000));
    const validRpm = safeFinite(rpm, 850);
    const validThrottle = Math.max(0, Math.min(1, safeFinite(throttle, 0)));
    const validSpeed = Math.max(0, safeFinite(speedKmh, 0));
    const validSkid = Math.max(0, safeFinite(maxSkidIntensity, 0));
    const validBoost = Math.max(0, safeFinite(turboBoostPsi, 0));
    const validKerb = Math.max(0, safeFinite(kerbRumbleIntensity, 0));

    const rpmNorm = Math.max(0, Math.min(1, validRpm / validMaxRpm));

    // Base fundamental frequency: 28 Hz (idle) up to 265 Hz (redline)
    let baseFreq = 28 + rpmNorm * 235;

    // Rev Limiter Spark Cut Pitch Stutter Drop
    if (isRevLimiting && revCutBounce) {
      baseFreq *= 0.92;
    }

    if (this.oscSub && this.oscHarmonic1 && this.oscHarmonic2 && this.oscHarmonic3) {
      safeSetTarget(this.oscSub.frequency, baseFreq, t, 0.025, 40);
      safeSetTarget(this.oscHarmonic1.frequency, baseFreq * 2, t, 0.025, 80);
      safeSetTarget(this.oscHarmonic2.frequency, baseFreq * 3.5, t, 0.025, 120);
      safeSetTarget(this.oscHarmonic3.frequency, baseFreq * 4.8, t, 0.025, 160);
    }

    // Engine Filter opens up with throttle and high RPM
    if (this.engineFilter) {
      const targetFilterFreq = 320 + rpmNorm * 2200 + validThrottle * 1400;
      safeSetTarget(this.engineFilter.frequency, targetFilterFreq, t, 0.035, 450);
    }

    // Engine Volume (stutter drops volume slightly on cut for crackling pop)
    if (this.engineGain) {
      let targetGain = 0.20 + validThrottle * 0.30 + rpmNorm * 0.20;
      if (isRevLimiting && revCutBounce) {
        targetGain *= 0.35;
      }
      safeSetTarget(this.engineGain.gain, targetGain, t, 0.02, 0.35);
    }

    // Turbocharger Whine Pitch & Volume
    if (this.turboWhineOsc && this.turboWhineGain && this.turboFilter) {
      if (validBoost > 0.5) {
        const boostNorm = Math.min(1.0, validBoost / 22);
        const turboFreq = 1200 + boostNorm * 3800 + (rpmNorm * 1200);
        safeSetTarget(this.turboWhineOsc.frequency, turboFreq, t, 0.04, 1200);
        safeSetTarget(this.turboFilter.frequency, turboFreq, t, 0.04, 1200);
        const turboVol = boostNorm * 0.16;
        safeSetTarget(this.turboWhineGain.gain, turboVol, t, 0.03, 0.0001);
      } else {
        safeSetTarget(this.turboWhineGain.gain, 0.0001, t, 0.06, 0.0001);
      }
    }

    // Dogbox Transmission Gear Whine (rises with road speed)
    if (this.gearWhineOsc && this.gearWhineGain) {
      if (validSpeed > 8) {
        const gearFreq = 160 + (validSpeed / 260) * 1450;
        safeSetTarget(this.gearWhineOsc.frequency, gearFreq, t, 0.04, 400);
        const gearVol = Math.min(0.09, (validSpeed / 240) * 0.09 * (0.3 + validThrottle * 0.7));
        safeSetTarget(this.gearWhineGain.gain, gearVol, t, 0.04, 0.0001);
      } else {
        safeSetTarget(this.gearWhineGain.gain, 0.0001, t, 0.06, 0.0001);
      }
    }

    // Turbo Blow-Off Valve (BOV) Flutter trigger
    if (turboBlowOff) {
      this.playBlowOffValve(validBoost);
    }

    // Tire Screech Volume and Frequency
    if (this.tireNoiseGain && this.tireFilter) {
      if (validSkid > 0.05) {
        const targetScreechGain = Math.min(0.48, validSkid * 0.44);
        const targetScreechFreq = 920 + validSkid * 650 + Math.min(160, validSpeed) * 4;
        safeSetTarget(this.tireNoiseGain.gain, targetScreechGain, t, 0.02, 0.0001);
        safeSetTarget(this.tireFilter.frequency, targetScreechFreq, t, 0.03, 1100);
      } else {
        safeSetTarget(this.tireNoiseGain.gain, 0.0001, t, 0.05, 0.0001);
      }
    }

    // ABS Chatter Vibration
    if (this.absChatterGain) {
      if (absActive) {
        safeSetTarget(this.absChatterGain.gain, 0.12, t, 0.02, 0.0001);
      } else {
        safeSetTarget(this.absChatterGain.gain, 0.0001, t, 0.04, 0.0001);
      }
    }

    // Kerb Rumble Vibration Buzz
    if (this.kerbRumbleOsc && this.kerbRumbleGain) {
      if (validKerb > 0.05 && validSpeed > 10) {
        const rumbleFreq = 28 + (validSpeed / 180) * 85;
        safeSetTarget(this.kerbRumbleOsc.frequency, rumbleFreq, t, 0.02, 32);
        safeSetTarget(this.kerbRumbleGain.gain, validKerb * 0.22, t, 0.02, 0.0001);
      } else {
        safeSetTarget(this.kerbRumbleGain.gain, 0.0001, t, 0.04, 0.0001);
      }
    }

    // Wind Volume
    if (this.windGain) {
      const speedNorm = Math.min(1.0, validSpeed / 240);
      const windVol = speedNorm > 0.08 ? Math.pow(speedNorm, 1.8) * 0.28 : 0.0001;
      safeSetTarget(this.windGain.gain, windVol, t, 0.08, 0.0001);
    }
  }

  public playBlowOffValve(boostPsi: number) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    try {
      const t = safeFinite(this.ctx.currentTime, 0);
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.35);
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
      }

      const noiseSource = this.ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      safeSetValue(filter.frequency, 2200, t, 2200);
      safeSetTarget(filter.frequency, 800, t, 0.1, 800);

      const gain = this.ctx.createGain();
      const safeBoost = safeFinite(boostPsi, 10);
      const vol = Math.min(0.4, 0.15 + (safeBoost / 20) * 0.25);
      safeSetValue(gain.gain, vol, t, 0.2);
      safeSetTarget(gain.gain, 0.0001, t + 0.05, 0.08, 0.0001);

      noiseSource.connect(filter);
      filter.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);

      noiseSource.start(t);
      noiseSource.stop(t + 0.35);
    } catch {
      // ignore
    }
  }

  public playBackfirePop() {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    try {
      const t = safeFinite(this.ctx.currentTime, 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      safeSetValue(osc.frequency, 180, t, 180);
      safeSetTarget(osc.frequency, 35, t, 0.02, 35);
      safeSetValue(gain.gain, 0.35, t, 0.35);
      safeSetTarget(gain.gain, 0.0001, t + 0.01, 0.02, 0.0001);

      osc.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.09);
    } catch {
      // ignore
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      safeSetTarget(this.masterGain.gain, this.isMuted ? 0 : 0.45, safeFinite(this.ctx.currentTime, 0), 0.05, 0.45);
    }
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }
}

export const globalAudio = new VehicleAudioSystem();

