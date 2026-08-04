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

/** Tarayıcı konuşma sentezi ile Türkçe sesli uyarı (ses kaydı yoksa). */
export function speak(text: string) {
  try {
    if (typeof speechSynthesis === "undefined") return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "tr-TR";
    u.rate = 1;
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

/** Dikkat çekmek için kısa bip sesi. */
export function beep() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => void ctx.close();
  } catch {
    /* ignore */
  }
}
