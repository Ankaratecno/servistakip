// 9. madde: "Servis Geliyor" uyarısı
// 500 m kala titreşim, 200 m kala alarm sesi + tarayıcı bildirimi.
// Eşikler yalnızca bir kez tetiklenir; servis uzaklaşırsa (RESET_M) sıfırlanır.

export const NEAR_M = 500;
export const ARRIVING_M = 200;
export const RESET_M = 800;

const PREF_KEY = "acrob-approach-alert";

export function isApproachAlertOn(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(PREF_KEY) !== "0";
}

export function setApproachAlertOn(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

/** Yükselen iki tonlu kısa alarm (Web Audio ile, dosya gerekmez). */
export function alarmTone() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.connect(gain);
    // 3 kez "di-dii"
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.5;
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(1320, t + 0.16);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    }
    osc.start(now);
    osc.stop(now + 1.6);
    osc.onended = () => void ctx.close();
  } catch {
    /* ignore */
  }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function notify(title: string, body: string) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(title, { body, tag: "acrob-approach", renotify: true } as NotificationOptions);
  } catch {
    /* ignore */
  }
}

export type ApproachStage = "far" | "near" | "arriving";

export interface ApproachState {
  stage: ApproachStage;
}

export const initialApproachState = (): ApproachState => ({ stage: "far" });

export interface ApproachEvent {
  stage: ApproachStage;
  changed: boolean;
}

/**
 * Mesafeyi işleyip hangi eşiğin yeni geçildiğini söyler.
 * State mutasyonu ref içinde tutulmak üzere yerinde yapılır.
 */
export function ingestDistance(state: ApproachState, distanceM: number): ApproachEvent {
  const prev = state.stage;
  if (distanceM > RESET_M) {
    state.stage = "far";
    return { stage: state.stage, changed: false };
  }
  if (distanceM <= ARRIVING_M) {
    state.stage = "arriving";
    return { stage: "arriving", changed: prev !== "arriving" };
  }
  if (distanceM <= NEAR_M) {
    if (prev === "far") {
      state.stage = "near";
      return { stage: "near", changed: true };
    }
    return { stage: prev, changed: false };
  }
  return { stage: prev, changed: false };
}
