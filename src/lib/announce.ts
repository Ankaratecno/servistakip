// 10. madde: Otomatik durak anonsu (TTS + GPS yakınlık) ve ani fren algılama.
// Her iki olay da şoför cihazında üretilir, yolculara PeerJS ile canlı gönderilir.

// ---------- 10.1 Otomatik durak anonsu ----------

/** Yedek (sabit) anons eşiği — dinamik eşik hesaplanamazsa kullanılır. */
export const ANNOUNCE_M = 350;
/**
 * #36: Anons kilidi artık mesafeyle DEĞİL, "durak geçildi" olayıyla sıfırlanır.
 * Yakın duraklarda (700 m'den az aralıklı) uyarı atlanması böylece biter.
 */

export interface StopAnnouncePayload {
  type: "announce";
  stopId: string;
  stopName: string;
  distanceM: number;
  /** Tahmini varış süresi (saniye) — ETA tabanlı anons metni için (#33) */
  etaS?: number;
  ts: number;
}

export interface AnnounceState {
  /** Anonsu yapılmış durak id'leri */
  announced: Set<string>;
}

export const initialAnnounceState = (): AnnounceState => ({ announced: new Set<string>() });

/**
 * Durak mesafesini işler; anons yapılması gerekiyorsa true döner.
 * Eşik hıza göre dinamik verilir (#35). Kilit yalnızca `resetAnnounce` ile
 * (durak geçildiğinde) açılır (#36).
 */
export function ingestStopDistance(
  state: AnnounceState,
  stopId: string,
  distanceM: number,
  thresholdM: number = ANNOUNCE_M,
): boolean {
  if (distanceM <= thresholdM && !state.announced.has(stopId)) {
    state.announced.add(stopId);
    return true;
  }
  return false;
}

/** Durak geçildiğinde anons kilidini açar (yeni tur / tekrar geçiş için). */
export function resetAnnounce(state: AnnounceState, stopId: string) {
  state.announced.delete(stopId);
}

export function announceText(stopName: string, etaS?: number | null): string {
  const base = `Sayın yolcular, yaklaşan durağımız ${stopName}`;
  if (etaS == null || !isFinite(etaS)) {
    return `${base}. İnecek yolcularımız hazırlansın.`;
  }
  if (etaS <= 45) return `${base}. Durağa geliyoruz, inecek yolcularımız hazırlansın.`;
  const mins = Math.max(1, Math.round(etaS / 60));
  return `${base}. Tahmini ${mins} dakika. İnecek yolcularımız hazırlansın.`;
}

// ---------- 10.2 Ani fren algılama ----------

export const BRAKE_G = 0.35; // orta şiddette fren
export const HARD_BRAKE_G = 0.55; // sert fren
const BRAKE_COOLDOWN_MS = 4000;
const GRAVITY = 9.80665;

export type BrakeLevel = "orta" | "sert";

export interface BrakeEventPayload {
  type: "brake";
  /** Tepe ivme (g) */
  g: number;
  level: BrakeLevel;
  /** Olay anındaki hız (km/s) */
  speedKmh: number;
  /** "sensör" = ivmeölçer, "gps" = hız düşüşü yedeği */
  source: "sensör" | "gps";
  ts: number;
}

export function brakeLevel(g: number): BrakeLevel {
  return g >= HARD_BRAKE_G ? "sert" : "orta";
}

/** iOS 13+ için ivmeölçer izni. */
export async function ensureMotionPermission(): Promise<boolean> {
  try {
    const DM = (
      window as unknown as {
        DeviceMotionEvent?: { requestPermission?: () => Promise<PermissionState | string> };
      }
    ).DeviceMotionEvent;
    if (!DM) return false;
    if (typeof DM.requestPermission !== "function") return true;
    const res = await DM.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

/**
 * İvmeölçeri dinler, ani ivme sıçramalarını (fren/çukur) g cinsinden bildirir.
 * Dönen fonksiyon dinlemeyi bırakır.
 */
export function startBrakeWatch(onBrake: (g: number) => void): () => void {
  if (typeof window === "undefined" || typeof window.DeviceMotionEvent === "undefined") {
    return () => undefined;
  }
  let baseline = 0;
  let lastFire = 0;
  const handler = (e: DeviceMotionEvent) => {
    const a = e.acceleration ?? e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
    if (!isFinite(mag)) return;
    // Yavaş değişen taban (yerçekimi / cihaz duruşu) düşülür
    baseline = baseline ? baseline + (mag - baseline) * 0.05 : mag;
    const g = Math.abs(mag - baseline) / GRAVITY;
    const now = Date.now();
    if (g >= BRAKE_G && now - lastFire > BRAKE_COOLDOWN_MS) {
      lastFire = now;
      onBrake(Math.min(g, 3));
    }
  };
  window.addEventListener("devicemotion", handler);
  return () => window.removeEventListener("devicemotion", handler);
}

/**
 * İvmeölçeri olmayan cihazlar için GPS yedeği: hız düşüşünden g hesaplar.
 * 0 dönerse fren sayılmaz.
 */
export function gpsBrakeG(prevKmh: number, nextKmh: number, dtSeconds: number): number {
  if (dtSeconds <= 0 || dtSeconds > 5) return 0;
  const drop = prevKmh - nextKmh;
  if (drop <= 0) return 0;
  const g = drop / 3.6 / dtSeconds / GRAVITY;
  return g >= BRAKE_G ? Math.min(g, 3) : 0;
}
