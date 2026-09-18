// Karşılama jingle'ı — 1. ve 9. duraklardan KALKIŞTA radyodan çalar.
//
// Tetikleme mantığı (GPS sapmasında durakta beklerken yanlış tetiklenmeyi
// hız şartı engeller):
//   1) Araç durağın varış yarıçapına girmiş olmalı (gerçekten durağa uğradı).
//   2) Yarıçaptan çıkılmış olmalı.
//   3) Hız 8 km/s üzerinde 5 saniye kesintisiz + duraktan en az 60 m uzaklaşma.
//   4) Bu şartlar dolmadan ≥120 m uzaklaşılırsa veya yarıçaptan çıkışın
//      üzerinden ≥12 sn geçmişse (hareket hâlindeyken) yine tetiklenir.
// Her durak için tur başına yalnızca bir kez çalar; araç 2 km uzaklaşınca
// kilit sıfırlanır (bir sonraki tur yeniden çalabilir).

import { arriveRadiusM } from "@/lib/passed-stops";
import { queueRadioAnnouncement } from "@/lib/radio-announce";
import { welcomeGreetingUrls, welcomeGreetingLabel } from "@/lib/voice-assets";

/** Karşılama yapılacak durak adları. */
const GREETING_STOPS = ["1.DURAK", "9.DURAK"];

const SPEED_KMH = 8;
const SPEED_HOLD_MS = 5000;
const MIN_DIST_M = 60;
const FAR_DIST_M = 120;
const MAX_WAIT_MS = 12000;
const RESET_M = 2000;

interface StopState {
  arrived: boolean;
  leftAt: number | null;
  speedSince: number | null;
  fired: boolean;
}

export interface DepartureGreetingState {
  stops: Map<string, StopState>;
}

export const initialDepartureGreetingState = (): DepartureGreetingState => ({ stops: new Map() });

function norm(name: string): string {
  return name.trim().toLocaleUpperCase("tr-TR").replace(/\s+/g, "");
}

export function hasDepartureGreeting(stopName: string): boolean {
  return GREETING_STOPS.includes(norm(stopName));
}

export interface DepartureGreetingInput {
  stopId: string;
  stopName: string;
  distanceM: number;
  speedKmh: number;
  accuracyM?: number | null;
  /** Şimdiki zaman (ms) — test edilebilirlik için. */
  now?: number;
}

/**
 * Kalkış şartları dolduysa karşılama anonsunu radyo kuyruğuna bırakır.
 * Çalınan anonsun etiketini döndürür (yoksa null).
 */
export function ingestDepartureGreeting(
  state: DepartureGreetingState,
  input: DepartureGreetingInput,
): string | null {
  if (!hasDepartureGreeting(input.stopName)) return null;
  const now = input.now ?? Date.now();

  let st = state.stops.get(input.stopId);
  if (!st) {
    st = { arrived: false, leftAt: null, speedSince: null, fired: false };
    state.stops.set(input.stopId, st);
  }

  // Yeni tur: çok uzaklaşınca kilitleri sıfırla.
  if (input.distanceM > RESET_M) {
    st.arrived = false;
    st.leftAt = null;
    st.speedSince = null;
    st.fired = false;
    return null;
  }

  const radius = arriveRadiusM(input.accuracyM);

  if (input.distanceM <= radius) {
    st.arrived = true;
    st.leftAt = null;
    st.speedSince = null;
    return null;
  }

  if (!st.arrived || st.fired) return null;

  if (st.leftAt == null) st.leftAt = now;

  // Hız şartı: 8 km/s üzerinde kesintisiz süre
  if (input.speedKmh > SPEED_KMH) {
    if (st.speedSince == null) st.speedSince = now;
  } else {
    st.speedSince = null;
  }

  const heldMs = st.speedSince != null ? now - st.speedSince : 0;
  const movingEnough = input.speedKmh > SPEED_KMH;
  const bySpeed = heldMs >= SPEED_HOLD_MS && input.distanceM >= MIN_DIST_M;
  const byDistance = movingEnough && input.distanceM >= FAR_DIST_M;
  const byTime = movingEnough && now - st.leftAt >= MAX_WAIT_MS && input.distanceM >= MIN_DIST_M;

  if (!(bySpeed || byDistance || byTime)) return null;

  st.fired = true;
  const label = welcomeGreetingLabel();
  queueRadioAnnouncement({
    id: `welcome-${input.stopId}-${now}`,
    label,
    urls: welcomeGreetingUrls(),
    soft: true,
    immediate: true,
  });
  return label;
}
