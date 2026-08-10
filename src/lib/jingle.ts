// "Elektro Radyo" jingle motoru — sentetik radyo imaging (riser + impact + stab)
// ile TTS istasyon anonsunu aynı AudioContext üzerinde birleştirir.
// Ses, DriverRadio'nun yayın gain'ine bağlandığı için yolcular da canlı duyar.

/** Jingle anons metinleri — ses TTS ile üretilir (statik mp3 yok). */
export const JINGLE_LINES = [
  "Elektro Radyo! Acrob Servis Radyosu, yolculuğun ritmi.",
  "Burası Elektro Radyo. Acrob Servis ile yoldasınız.",
  "Elektro Radyo, servis yolculuğunuzun sesi.",
];

const bufferCache = new Map<string, AudioBuffer>();

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return bytes.buffer;
}

/** TTS'ten gelen base64 mp3'ü decode eder, metne göre önbelleğe alır. */
export async function loadVoiceBuffer(
  ctx: AudioContext,
  key: string,
  fetchMp3: () => Promise<string>,
): Promise<AudioBuffer> {
  const cached = bufferCache.get(key);
  if (cached) return cached;
  const buf = await ctx.decodeAudioData(base64ToArrayBuffer(await fetchMp3()));
  bufferCache.set(key, buf);
  return buf;
}

export async function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(url);
  if (cached) return cached;
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr);
  bufferCache.set(url, buf);
  return buf;
}

function noiseBuffer(ctx: AudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Yükselen riser + beyaz gürültü sweep (anons öncesi gerilim). */
function riser(ctx: AudioContext, out: AudioNode, t: number, dur: number) {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(1200, t + dur);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(400, t);
  filter.frequency.exponentialRampToValueAtTime(6000, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.22, t + dur * 0.9);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
  osc.connect(filter).connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.2);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, dur + 0.3);
  const nf = ctx.createBiquadFilter();
  nf.type = "bandpass";
  nf.Q.value = 1.2;
  nf.frequency.setValueAtTime(500, t);
  nf.frequency.exponentialRampToValueAtTime(9000, t + dur);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.18, t + dur);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
  noise.connect(nf).connect(ng).connect(out);
  noise.start(t);
  noise.stop(t + dur + 0.3);
}

/** Sub-bass düşüş (anonsun tam üstüne binen "boom"). */
function impact(ctx: AudioContext, out: AudioNode, t: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(38, t + 0.7);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.55, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + 1.2);
}

/** Elektro akor stab'ı (anons bitiminde patlayan sentetik akor). */
function stab(ctx: AudioContext, out: AudioNode, t: number) {
  const freqs = [220, 277.18, 329.63, 440, 659.25];
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = i % 2 === 0 ? "sawtooth" : "square";
    osc.frequency.setValueAtTime(f, t);
    osc.detune.setValueAtTime(i * 4 - 8, t);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(7000, t);
    filter.frequency.exponentialRampToValueAtTime(900, t + 1.2);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    osc.connect(filter).connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + 1.4);
  });
}

/** Kısa elektro arp (voice altında akan ritmik doku). */
function arp(ctx: AudioContext, out: AudioNode, t: number, dur: number) {
  const notes = [110, 164.81, 220, 164.81];
  const step = 0.16;
  for (let i = 0; t + i * step < t + dur; i++) {
    const at = t + i * step;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(notes[i % notes.length]!, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.07, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + step * 0.9);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + step);
  }
}

interface JingleOptions {
  /** Anons sesi (istasyon ID'si veya saat anonsu). null ise sadece müzikal jingle çalar. */
  voice: AudioBuffer | null;
  /** Sadece riser + stab, arp olmadan (saat anonsu için daha sakin) */
  soft?: boolean;
  /** voice yoksa jingle'ın orta bölümünün süresi (sn) */
  bedDuration?: number;
}

/** Jingle'ı çalar, bittiğinde resolve olur. */
export function playJingle(ctx: AudioContext, out: AudioNode, opts: JingleOptions): Promise<void> {
  const t0 = ctx.currentTime + 0.08;
  const riseDur = opts.soft ? 0.9 : 1.5;
  const voiceAt = t0 + riseDur;
  const bodyDur = opts.voice ? opts.voice.duration : (opts.bedDuration ?? 2.6);

  riser(ctx, out, t0, riseDur);
  impact(ctx, out, voiceAt - 0.05);
  if (!opts.soft) arp(ctx, out, voiceAt, bodyDur);

  if (opts.voice) {
    const vg = ctx.createGain();
    vg.gain.value = 1.25;
    const src = ctx.createBufferSource();
    src.buffer = opts.voice;
    src.connect(vg).connect(out);
    src.start(voiceAt);
  }

  const endAt = voiceAt + bodyDur;
  stab(ctx, out, endAt + 0.05);

  const totalMs = (endAt + 1.5 - ctx.currentTime) * 1000;
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(300, totalMs)));
}

export function randomJingleLine(): string {
  return JINGLE_LINES[Math.floor(Math.random() * JINGLE_LINES.length)]!;
}

export function hourAnnouncementText(d = new Date()): string {
  const hh = String(d.getHours()).padStart(2, "0");
  return `Saat ${hh} sıfır sıfır. Acrob Servis Radyosu, Elektro Radyo ile yoldasınız.`;
}
