/**
 * 音效引擎。
 *
 * 枪声、吼叫、死亡、受击、爆头用 public/audio 下的采样播放；界面点击仍用 Web Audio 合成。
 * 浏览器自动播放策略要求 AudioContext 必须在用户手势里创建 / 恢复，
 * 所以 unlock() 要绑在首次点击或按键上；在那之前所有播放接口都是安全的空操作。
 */

const STORAGE_KEY = 'zombie-survivor:audio-enabled';
/** 主音量，限幅器之上再留一点余量。 */
const MASTER_VOLUME = 0.5;
/** 同时存活的声部上限，尸潮密集时防止所有声音糊成一团。 */
const MAX_VOICES = 26;
/** weight 达到该值视为大块头，改播超级僵尸死亡采样。 */
const BRUTE_DEATH_WEIGHT = 1.5;

type SampleId =
  | 'shoot'
  | 'growl'
  | 'vomit'
  | 'zombieDeath'
  | 'bruteDeath'
  | 'playerDeath'
  | 'hit'
  | 'headshot';

const SAMPLE_URLS: Record<SampleId, string> = {
  shoot: './audio/gunshot.mp3',
  growl: './audio/zombie.mp3',
  vomit: './audio/zombie2.mp3',
  zombieDeath: './audio/zombie_dead.mp3',
  bruteDeath: './audio/boss_zombie_dead.mp3',
  playerDeath: './audio/male-death-scream.mp3',
  hit: './audio/beat.mp3',
  headshot: './audio/cf-headshot.mp3',
};

const GROWL_IDS: readonly SampleId[] = ['growl', 'vomit'];

/** 已建好的固定总线：主增益、混响发送。 */
interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  reverb: GainNode;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readStoredEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    // 隐私模式读不到就按默认开启处理
    return true;
  }
}

function writeStoredEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // 存不进去也不影响本次会话
  }
}

/** 指数衰减噪声做脉冲响应，得到一个廉价但够用的废土混响。 */
function createImpulseResponse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      const progress = index / length;
      // 前 40 个采样淡入，否则混响第一帧会是一记咔哒
      const edge = index < 40 ? index / 40 : 1;
      data[index] = (Math.random() * 2 - 1) * (1 - progress) ** decay * edge;
    }
  }
  return buffer;
}

export class SoundEngine {
  private graph: AudioGraph | null = null;
  private enabled = readStoredEnabled();
  /** 只有战斗进行中才循环播放吼叫。 */
  private active = false;
  /** 距离下一次吼叫的倒计时，秒。 */
  private growlTimer = 2.2;
  /** 已排期声部的结束时刻，用来做并发预算。 */
  private voices: number[] = [];
  private lastPlayed = new Map<string, number>();
  /** fetch 到的原始字节，解码前先囤着，dispose 后还能重新 decode。 */
  private readonly rawSamples = new Map<SampleId, ArrayBuffer>();
  private readonly samples = new Map<SampleId, AudioBuffer>();

  constructor() {
    void this.fetchSamples();
  }

  /** 在首个用户手势（点击 / 按键）里调用，创建并恢复 AudioContext。 */
  unlock(): void {
    if (!this.graph) this.createGraph();
    void this.decodeSamples();
    if (this.graph?.ctx.state === 'suspended') void this.graph.ctx.resume();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    writeStoredEnabled(enabled);
    if (!this.graph) return;
    const { ctx, master } = this.graph;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
    master.gain.linearRampToValueAtTime(enabled ? MASTER_VOLUME : 0, now + 0.06);
    if (!enabled) this.voices = [];
  }

  /** 翻转开关，返回翻转后的状态。 */
  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /** 战斗是否进行中；关掉只掐掉吼叫循环，已排期的一次性音效会自然收尾。 */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) this.growlTimer = Math.min(this.growlTimer, 1.1);
  }

  /** 新开一局：清掉上一局残留的排期与节流状态。 */
  startRun(): void {
    this.voices = [];
    this.lastPlayed.clear();
    this.growlTimer = 2.2;
  }

  dispose(): void {
    this.voices = [];
    this.lastPlayed.clear();
    this.active = false;
    this.samples.clear();
    void this.graph?.ctx.close();
    this.graph = null;
  }

  private async fetchSamples(): Promise<void> {
    const ids = Object.keys(SAMPLE_URLS) as SampleId[];
    const loaded = await Promise.all(
      ids.map(async (id) => {
        try {
          const response = await fetch(encodeURI(SAMPLE_URLS[id]));
          if (!response.ok) return null;
          return [id, await response.arrayBuffer()] as const;
        } catch {
          return null;
        }
      }),
    );
    for (const entry of loaded) {
      if (entry) this.rawSamples.set(entry[0], entry[1]);
    }
    await this.decodeSamples();
  }

  private async decodeSamples(): Promise<void> {
    const ctx = this.graph?.ctx;
    if (!ctx) return;
    await Promise.all(
      [...this.rawSamples].map(async ([id, data]) => {
        if (this.samples.has(id)) return;
        try {
          const buffer = await ctx.decodeAudioData(data.slice(0));
          this.samples.set(id, buffer);
        } catch {
          // 坏文件跳过，对应播放接口会变成空操作
        }
      }),
    );
  }

  private createGraph(): void {
    const ctx = new AudioContext({ latencyHint: 'interactive' });

    const master = ctx.createGain();
    master.gain.value = this.enabled ? MASTER_VOLUME : 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -7;
    limiter.knee.value = 8;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.22;
    master.connect(limiter);
    limiter.connect(ctx.destination);

    const convolver = ctx.createConvolver();
    convolver.buffer = createImpulseResponse(ctx, 1.6, 3);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    const reverb = ctx.createGain();
    reverb.gain.value = 1;
    reverb.connect(convolver);
    convolver.connect(wet);
    wet.connect(master);

    this.graph = {
      ctx,
      master,
      reverb,
    };
  }

  /**
   * 播放闸门：同类音效的最小间隔 + 全局并发预算。
   * 返回 null 表示这次直接丢弃 —— 尸潮刷屏时宁可丢声音，也不要堆成噪音墙。
   */
  private gate(key: string, minGap: number, cost: number, duration: number): AudioGraph | null {
    const graph = this.graph;
    if (!this.enabled || !graph) return null;
    const now = graph.ctx.currentTime;
    if (now - (this.lastPlayed.get(key) ?? -1) < minGap) return null;

    const live: number[] = [];
    for (const end of this.voices) {
      if (end > now) live.push(end);
    }
    if (live.length + cost > MAX_VOICES) return null;
    for (let index = 0; index < cost; index += 1) live.push(now + duration);

    this.voices = live;
    this.lastPlayed.set(key, now);
    return graph;
  }

  /** 声音出口：电平 → 声像 → 主总线，并附一路混响发送。 */
  private output(graph: AudioGraph, pan: number, send: number, level: number): GainNode {
    const bus = graph.ctx.createGain();
    bus.gain.value = level;
    const panner = graph.ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    bus.connect(panner);
    panner.connect(graph.master);
    if (send > 0) {
      const wet = graph.ctx.createGain();
      wet.gain.value = send;
      panner.connect(wet);
      wet.connect(graph.reverb);
    }
    return bus;
  }

  private playSample(
    id: SampleId,
    gateKey: string,
    minGap: number,
    pan: number,
    send: number,
    level: number,
    rate = 1,
  ): void {
    const buffer = this.samples.get(id);
    if (!buffer) return;
    const playbackRate = Math.max(0.1, rate);
    const duration = buffer.duration / playbackRate;
    const graph = this.gate(gateKey, minGap, 1, duration);
    if (!graph) return;

    const { ctx } = graph;
    const t = ctx.currentTime + 0.004;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(this.output(graph, pan, send, level));
    this.start(source, t, t + duration + 0.05);
  }

  /** AD 包络：指数衰减，峰值与零点都不能取 0。 */
  private env(gain: GainNode, when: number, peak: number, attack: number, decay: number): void {
    const param = gain.gain;
    param.setValueAtTime(0.0001, when);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack);
    param.exponentialRampToValueAtTime(0.0001, when + attack + decay);
  }

  private start(node: AudioScheduledSourceNode, when: number, stopAt: number): void {
    node.start(when);
    node.stop(stopAt);
  }

  shoot(pan = 0, volume = 1): void {
    this.playSample(
      'shoot',
      'shoot',
      0.035,
      pan + rand(-0.08, 0.08),
      0.07,
      0.62 * clamp(volume, 0.6, 1.25),
      rand(0.96, 1.04),
    );
  }

  /**
   * 僵尸吼叫。variant 在「叫声 / 呕吐声」两段采样间轮转，
   * intensity 0 = 远处隐约可闻，1 = 贴脸。
   */
  growl(variant: number, intensity = 1, pan = 0): void {
    const id = GROWL_IDS[variant % GROWL_IDS.length];
    this.playSample(
      id,
      'growl',
      0.3,
      pan,
      0.28,
      0.48 * (0.3 + 0.7 * clamp(intensity, 0, 1)),
      rand(0.92, 1.08),
    );
  }

  /** 爆头命中，和飘字同步。短间隔防止穿透连爆糊成一片。 */
  headshot(pan = 0): void {
    this.playSample('headshot', 'headshot', 0.08, pan + rand(-0.08, 0.08), 0.1, 0.7, rand(0.98, 1.02));
  }

  /** 僵尸死亡。weight 达到大块头阈值时改播超级死亡采样。 */
  zombieDeath(pan = 0, weight = 1): void {
    const brute = weight >= BRUTE_DEATH_WEIGHT;
    this.playSample(
      brute ? 'bruteDeath' : 'zombieDeath',
      'zombie-death',
      0.05,
      pan + rand(-0.14, 0.14),
      0.18,
      brute ? 0.62 : 0.55,
      brute ? rand(0.9, 1.02) : rand(0.94, 1.06),
    );
  }

  /** 角色受击。致死那一击也会播，随后再叠死亡采样。 */
  hit(): void {
    this.playSample('hit', 'hit', 0.08, rand(-0.1, 0.1), 0.12, 0.52, rand(0.94, 1.06));
  }

  /** 角色死亡。先掐掉吼叫循环，再播尖叫采样。 */
  playerDeath(): void {
    this.setActive(false);
    this.playSample(
      'playerDeath',
      'player-death',
      0.8,
      rand(-0.12, 0.12),
      0.22,
      0.7,
      rand(0.96, 1.04),
    );
  }

  /** 界面点击音，用于确认音效开关已经打开。 */
  ui(): void {
    const graph = this.gate('ui', 0.08, 2, 0.16);
    if (!graph) return;
    const { ctx } = graph;
    const t = ctx.currentTime + 0.004;
    const out = this.output(graph, 0, 0.12, 0.34);
    for (const [frequency, delay, level] of [
      [520, 0, 0.4],
      [780, 0.045, 0.28],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      osc.connect(gain).connect(out);
      this.env(gain, t + delay, level, 0.004, 0.08);
      this.start(osc, t + delay, t + delay + 0.14);
    }
  }

  /**
   * 每帧驱动的吼叫循环。
   * intensity 由最近僵尸的距离与尸潮密度折算，越近越密、越远越稀。
   */
  update(delta: number, intensity: number, pan: number): void {
    if (!this.active || !this.graph) return;
    this.growlTimer -= delta;
    if (this.growlTimer > 0) return;

    const closeness = clamp(intensity, 0, 1);
    const interval = 6.2 - 4.4 * closeness;
    this.growlTimer = interval * rand(0.72, 1.32);
    this.growl(
      Math.floor(Math.random() * GROWL_IDS.length),
      0.4 + 0.6 * closeness,
      clamp(pan + rand(-0.22, 0.22), -1, 1),
    );
  }
}
