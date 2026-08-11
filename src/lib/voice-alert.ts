import { sharedAudioContext } from "@/lib/audio-context";

// Yolcu → Şoför sesli/erken uyarı sistemi için ortak tipler ve yardımcılar.

export interface VoiceAlertPayload {
  type: "alert";
  kind: "voice" | "absent";
  /** base64 (data URL gövdesi olmadan) ses verisi – sadece kind==="voice" */
  audio?: string;
  mime?: string;
  /** Sesli olmayan / yedek metin uyarısı */
  text?: string;
  stopId: string | null;
  stopName: string | null;
  ts: number;
}

export function pickRecorderMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Ses okunamadı"));
    fr.onload = () => {
      const res = String(fr.result);
      resolve(res.slice(res.indexOf(",") + 1));
    };
    fr.readAsDataURL(blob);
  });
}

export async function playBase64Audio(base64: string, mime: string) {
  const audio = new Audio(`data:${mime || "audio/webm"};base64,${base64}`);
  audio.volume = 1;
  await audio.play().catch(() => undefined);
}

/** Konuşma başladı/bitti aboneleri (radyo kısma için). */
type SpeakListener = (speaking: boolean) => void;
const speakListeners = new Set<SpeakListener>();
let speakingNow = false;

export function onSpeaking(fn: SpeakListener): () => void {
  speakListeners.add(fn);
  fn(speakingNow);
  return () => speakListeners.delete(fn);
}

function setSpeaking(v: boolean) {
  if (speakingNow === v) return;
  speakingNow = v;
  speakListeners.forEach((f) => {
    try {
      f(v);
    } catch {
      /* ignore */
    }
  });
}

export function isSpeaking() {
  return speakingNow;
}

// YAPILACAKLAR3 #30: TTS kuyruğu — durak anonsu, fren ve saat anonsu
// üst üste binmesin; sırayla konuşulsun.
const queue: string[] = [];
let running = false;

function runQueue() {
  if (running) return;
  const text = queue.shift();
  if (text === undefined) {
    setSpeaking(false);
    return;
  }
  running = true;
  setSpeaking(true);
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "tr-TR";
    u.rate = 1;
    const done = () => {
      running = false;
      window.setTimeout(runQueue, 120);
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
    // Bazı tarayıcılarda onend hiç gelmez; süreye göre emniyet zamanlayıcısı.
    window.setTimeout(
      () => {
        if (running) done();
      },
      Math.max(4000, text.length * 110),
    );
  } catch {
    running = false;
    setSpeaking(false);
  }
}

/** Tarayıcı konuşma sentezi ile Türkçe sesli uyarı (kuyruklu). */
export function speak(text: string) {
  if (typeof speechSynthesis === "undefined" || !text) return;
  if (queue.length > 4) queue.shift();
  queue.push(text);
  runQueue();
}

export function cancelSpeech() {
  queue.length = 0;
  try {
    speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  running = false;
  setSpeaking(false);
}

/** Dikkat çekmek için kısa bip sesi (paylaşılan AudioContext — #31). */
export function beep() {
  try {
    const ctx = sharedAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    /* ignore */
  }
}
