// Şoför sürüş istatistikleri - IndexedDB'de kalıcı (şoför silene kadar durmaz)
export interface TripStats {
  totalMeters: number;
  movingSeconds: number; // hareket halinde geçen süre
  maxSpeedKmh: number;
  startedAt: number;
  updatedAt: number;
}

const DB_NAME = "acrob-trip-stats";
const STORE = "stats";
const KEY = "current";

export const EMPTY_STATS: TripStats = {
  totalMeters: 0,
  movingSeconds: 0,
  maxSpeedKmh: 0,
  startedAt: Date.now(),
  updatedAt: Date.now(),
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadStats(): Promise<TripStats> {
  try {
    const db = await openDb();
    return await new Promise<TripStats>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as TripStats) ?? { ...EMPTY_STATS });
      req.onerror = () => resolve({ ...EMPTY_STATS });
    });
  } catch {
    return { ...EMPTY_STATS };
  }
}

export async function saveStats(stats: TripStats): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(stats, KEY);
  } catch {
    /* ignore */
  }
}

export async function resetStats(): Promise<TripStats> {
  const fresh: TripStats = { ...EMPTY_STATS, startedAt: Date.now(), updatedAt: Date.now() };
  await saveStats(fresh);
  return fresh;
}

export function avgSpeedKmh(stats: TripStats): number {
  if (stats.movingSeconds < 15) return 0;
  const v = stats.totalMeters / 1000 / (stats.movingSeconds / 3600);
  if (!isFinite(v) || v < 0) return 0;
  return Math.min(v, MAX_PLAUSIBLE_KMH);
}

// ============ GPS gürültü filtresi ============
// Amaç: durakta beklerken km artmasın, GPS zıplaması "91 km/s" gibi sahte
// zirveler üretmesin. Tüm eşikler servis aracı (şehir içi) için ayarlı.
export const MAX_PLAUSIBLE_KMH = 160;
const MAX_ACCURACY_M = 30; // bundan kötü fix tamamen atılır
const MAX_ACCEL_KMH_PER_S = 8; // gerçek araç ivmesi sınırı
const MIN_DT = 1; // saniye
const MAX_DT = 600; // saniye (kırmızı ışık / mola: 10 dk'ya kadar tolerans)
const SPEED_SMOOTHING = 0.45; // EMA katsayısı (daha hızlı tepki)

export interface FixInput {
  lat: number;
  lng: number;
  ts: number;
  accuracy: number;
  gpsSpeedKmh: number | null;
}

export interface FilterState {
  lastFix: FixInput | null;
  smoothedKmh: number;
  fastStreak: number; // yüksek hız kaç kez üst üste doğrulandı
}

export const initialFilterState = (): FilterState => ({
  lastFix: null,
  smoothedKmh: 0,
  fastStreak: 0,
});

export interface FixResult {
  stats: TripStats;
  speedKmh: number; // yumuşatılmış anlık hız
  accepted: boolean;
}

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function ingestFix(stats: TripStats, state: FilterState, fix: FixInput): FixResult {
  // 1) Doğruluğu kötü fixleri hiç kullanma
  if (!isFinite(fix.accuracy) || fix.accuracy > MAX_ACCURACY_M) {
    return { stats, speedKmh: state.smoothedKmh, accepted: false };
  }

  const prev = state.lastFix;
  if (!prev) {
    state.lastFix = fix;
    return { stats, speedKmh: state.smoothedKmh, accepted: false };
  }

  const dt = (fix.ts - prev.ts) / 1000;
  if (dt < MIN_DT) {
    return { stats, speedKmh: state.smoothedKmh, accepted: false };
  }
  if (dt > MAX_DT) {
    // Uzun bekleme sonrası: state'i tazele, GPS kendi hızını veriyorsa onu göster
    state.lastFix = fix;
    state.fastStreak = 0;
    const gpsNow =
      fix.gpsSpeedKmh != null && isFinite(fix.gpsSpeedKmh)
        ? Math.min(Math.max(0, fix.gpsSpeedKmh), MAX_PLAUSIBLE_KMH)
        : 0;
    state.smoothedKmh = gpsNow;
    return { stats, speedKmh: gpsNow, accepted: false };
  }

  const dm = haversine(prev, fix);
  // 2) Konum belirsizliğinden küçük hareketler = gürültü (durakta bekleme)
  const noiseFloor = Math.max(4, (fix.accuracy + prev.accuracy) * 0.4);
  if (dm < noiseFloor) {
    state.lastFix = fix;
    state.smoothedKmh = state.smoothedKmh * (1 - SPEED_SMOOTHING);
    state.fastStreak = 0;
    return { stats, speedKmh: state.smoothedKmh, accepted: false };
  }

  const segKmh = (dm / dt) * 3.6;
  // 3) İmkânsız hız veya imkânsız ivme = GPS zıplaması
  if (segKmh > MAX_PLAUSIBLE_KMH) {
    state.lastFix = fix;
    return { stats, speedKmh: state.smoothedKmh, accepted: false };
  }
  if (Math.abs(segKmh - state.smoothedKmh) / dt > MAX_ACCEL_KMH_PER_S && state.smoothedKmh > 0) {
    state.lastFix = fix;
    return { stats, speedKmh: state.smoothedKmh, accepted: false };
  }

  // 4) GPS hızı varsa segment hızıyla çapraz doğrula, küçüğünü baz al
  const gps =
    fix.gpsSpeedKmh != null && isFinite(fix.gpsSpeedKmh) ? Math.max(0, fix.gpsSpeedKmh) : null;
  const measured = gps != null && gps <= MAX_PLAUSIBLE_KMH ? Math.min(gps, segKmh) : segKmh;

  state.smoothedKmh = state.smoothedKmh
    ? state.smoothedKmh + (measured - state.smoothedKmh) * SPEED_SMOOTHING
    : measured;

  // 5) Zirve hız sadece üst üste 3 doğrulanmış fix sonrası güncellenir
  state.fastStreak = measured > stats.maxSpeedKmh ? state.fastStreak + 1 : 0;
  const nextMax = state.fastStreak >= 3 ? Math.min(measured, MAX_PLAUSIBLE_KMH) : stats.maxSpeedKmh;

  const next: TripStats = {
    totalMeters: stats.totalMeters + dm,
    movingSeconds: stats.movingSeconds + dt,
    maxSpeedKmh: Math.max(stats.maxSpeedKmh, nextMax),
    startedAt: stats.startedAt || fix.ts,
    updatedAt: fix.ts,
  };
  state.lastFix = fix;
  return { stats: next, speedKmh: state.smoothedKmh, accepted: true };
}
