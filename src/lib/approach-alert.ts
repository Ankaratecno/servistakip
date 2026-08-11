import { sharedAudioContext } from "@/lib/audio-context";

// 9. madde + YAPILACAKLAR3 D bölümü: "Servis Geliyor" uyarısı.
// Uyarılar artık ETA (süre) tabanlı: 5 dk / 2 dk / kapıda (#33). Mesafe yalnızca
// süre bilinmiyorsa yedek olarak kullanılır. Servis uzaklaşıyorsa uyarı çıkmaz (#34).

export const NEAR_M = 500;
export const ARRIVING_M = 200;
export const DOOR_M = 80;
export const RESET_M = 800;

/** ETA eşikleri (saniye) */
export const NEAR_S = 300;
export const ARRIVING_S = 120;
export const DOOR_S = 30;

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

/** Yükselen iki tonlu kısa alarm (paylaşılan AudioContext — #31). */
export function alarmTone() {
  try {
    const ctx = sharedAudioContext();
    if (!ctx) return;
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
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
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

/** #38: iOS'ta Notification/vibrate yok — görsel flaş + ses yedeği gerekir. */
export function hasNotificationSupport(): boolean {
  return typeof window !== "undefined" && typeof Notification !== "undefined";
}

export function hasVibrationSupport(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function needsVisualFallback(): boolean {
  return !hasNotificationSupport() || Notification.permission !== "granted";
}

export type ApproachStage = "far" | "near" | "arriving" | "door";

const STAGE_ORDER: Record<ApproachStage, number> = { far: 0, near: 1, arriving: 2, door: 3 };

export interface ApproachState {
  stage: ApproachStage;
}

export const initialApproachState = (): ApproachState => ({ stage: "far" });

export interface ApproachEvent {
  stage: ApproachStage;
  changed: boolean;
}

export interface ApproachInput {
  distanceM: number;
  /** Tahmini varış süresi (saniye); yoksa mesafe eşiklerine düşülür. */
  etaS?: number | null;
  /** Servis durağa yaklaşıyor mu (#34). false ise uyarı üretilmez. */
  approaching?: boolean;
}

export function stageLabel(stage: ApproachStage): string {
  if (stage === "door") return "Kapıda";
  if (stage === "arriving") return "2 dakika";
  if (stage === "near") return "5 dakika";
  return "Uzakta";
}

/**
 * ETA (varsa) ve mesafeye göre aşama belirler. Aşama yalnızca ileri yönde
 * (far → near → arriving → door) tetiklenir; geri düşüş uyarı üretmez.
 */
export function ingestApproach(state: ApproachState, input: ApproachInput): ApproachEvent {
  const prev = state.stage;
  const { distanceM, etaS, approaching = true } = input;

  if (distanceM > RESET_M && (etaS == null || etaS > NEAR_S)) {
    state.stage = "far";
    return { stage: "far", changed: false };
  }

  let stage: ApproachStage = "far";
  if (etaS != null && isFinite(etaS)) {
    if (etaS <= DOOR_S || distanceM <= DOOR_M) stage = "door";
    else if (etaS <= ARRIVING_S) stage = "arriving";
    else if (etaS <= NEAR_S) stage = "near";
  } else {
    if (distanceM <= DOOR_M) stage = "door";
    else if (distanceM <= ARRIVING_M) stage = "arriving";
    else if (distanceM <= NEAR_M) stage = "near";
  }

  if (STAGE_ORDER[stage] <= STAGE_ORDER[prev]) return { stage: prev, changed: false };
  if (!approaching) return { stage: prev, changed: false };
  state.stage = stage;
  return { stage, changed: true };
}

// ---------- #40: uyarı geçmişi ----------

export interface AlertHistoryItem {
  stage: ApproachStage;
  stopName: string;
  text: string;
  ts: number;
}

const HISTORY_KEY = "acrob-alert-history";
const HISTORY_MAX = 12;

export function loadAlertHistory(): AlertHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as AlertHistoryItem[];
    return Array.isArray(arr) ? arr.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

export function pushAlertHistory(
  list: AlertHistoryItem[],
  item: AlertHistoryItem,
): AlertHistoryItem[] {
  const next = [item, ...list].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function clearAlertHistory(): AlertHistoryItem[] {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * Mesafeyi işleyip hangi eşiğin yeni geçildiğini söyler.
 * State mutasyonu ref içinde tutulmak üzere yerinde yapılır.
 */
export function ingestDistance(state: ApproachState, distanceM: number): ApproachEvent {
  return ingestApproach(state, { distanceM });
}
