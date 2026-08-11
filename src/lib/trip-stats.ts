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
  // Bulgu 11: movingSeconds artık yalnızca fiilî hareket süresini içerir (duruşlar hariç),
  // böylece ortalama hız kırmızı ışıkta/molada aşağı çekilmez.
  if (stats.movingSeconds < 15) return 0;
  const v = stats.totalMeters / 1000 / (stats.movingSeconds / 3600);
  if (!isFinite(v) || v < 0) return 0;
  return Math.min(v, MAX_PLAUSIBLE_KMH);
}

// ============ GPS gürültü filtresi ============
// Amaç: durakta beklerken km artmasın, GPS zıplaması "91 km/s" gibi sahte
// zirveler üretmesin. Tüm eşikler servis aracı (şehir içi) için ayarlı.
export const MAX_PLAUSIBLE_KMH = 160;
// Bulgu 8: 30 m katı eşik şehir içi kötü sinyalde sayacı tamamen donduruyordu.
// İki kademeli eşik: 35 m'ye kadar normal, 90 m'ye kadar "zayıf fix" (daha yüksek
// gürültü tabanı + mesafe yazılır ama zirve hız güncellenmez), üstü atılır.
const GOOD_ACCURACY_M = 35;
const MAX_ACCURACY_M = 90;
// YAPILACAKLAR3 #3: ivme kapısı artık simetrik değil. Frenleme hızlanmadan çok
// daha sert olabilir; simetrik 8 km/s/s frende hızı yüksek değerde kilitliyordu.
const MAX_ACCEL_KMH_PER_S = 6; // hızlanma sınırı
const MAX_DECEL_KMH_PER_S = 15; // yavaşlama sınırı (fren)
// YAPILACAKLAR3 #6: Android çoğu zaman ~0.9 sn aralıkla fix üretiyor; 1 sn eşiği
// bu fixleri tamamen çöpe atıyordu.
const MIN_DT = 0.4; // saniye
// Bulgu 9: arka plandan dönüşte tek adımda büyük km sıçramasını önlemek için
// 90 sn'den uzun boşluklarda mesafe yazılmaz, sadece hız/konum tazelenir.
const GAP_DT = 90; // saniye
const MAX_DT = 600; // saniye (bu üzeri tam sıfırlama)
// YAPILACAKLAR3 #8: sabit EMA yerine zaman tabanlı EMA (1 - exp(-dt/tau)).
const SPEED_TAU_S = 2.2;
// YAPILACAKLAR3 #4: gürültü tabanına üst sınır - 90 m fix'te 108 m eşik
// şehir içi gerçek hareketi "gürültü" sayıp sayacı donduruyordu.
const MAX_NOISE_FLOOR_M = 38;
// GPS kendi hız alanı bu değerin üstündeyse hareket teyit edilmiş sayılır
// ve gürültü tabanı esnetilir.
const GPS_MOVE_CONFIRM_KMH = 6;
// YAPILACAKLAR3 #11: uzun boşluktan sonra kısa "kalibre ediliyor" süresi
const CALIBRATION_MS = 4000;
// Bulgu 10: bu hızın altı "duruş" sayılır (GPS hayalet hızı temizlenir)
const IDLE_KMH = 3;

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
  /** YAPILACAKLAR3 #11: uzun boşluk sonrası kalibrasyon bitiş zamanı (ms) */
  calibratingUntil: number;
}

export const initialFilterState = (): FilterState => ({
  lastFix: null,
  smoothedKmh: 0,
  fastStreak: 0,
  calibratingUntil: 0,
});

export interface FixResult {
  stats: TripStats;
  speedKmh: number; // yumuşatılmış anlık hız
  accepted: boolean;
  /** Uzun boşluk sonrası hız henüz oturmadı */
  calibrating: boolean;
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
  const calibrating = () => fix.ts < state.calibratingUntil;
  const reject = (): FixResult => ({
    stats,
    speedKmh: state.smoothedKmh,
    accepted: false,
    calibrating: calibrating(),
  });

  // 1) Doğruluğu tamamen kullanılamaz fixleri at
  if (!isFinite(fix.accuracy) || fix.accuracy > MAX_ACCURACY_M) return reject();
  const weakFix = fix.accuracy > GOOD_ACCURACY_M;

  const prev = state.lastFix;
  if (!prev) {
    state.lastFix = fix;
    return reject();
  }

  const dt = (fix.ts - prev.ts) / 1000;
  if (dt < MIN_DT) return reject();

  const gps =
    fix.gpsSpeedKmh != null && isFinite(fix.gpsSpeedKmh)
      ? Math.min(Math.max(0, fix.gpsSpeedKmh), MAX_PLAUSIBLE_KMH)
      : null;

  if (dt > GAP_DT) {
    // Bulgu 9 + #11: uzun boşluk → mesafe yazma, tazele ve kalibrasyon işaretle.
    state.lastFix = fix;
    state.fastStreak = 0;
    state.smoothedKmh = gps == null || gps < IDLE_KMH ? 0 : gps;
    state.calibratingUntil = fix.ts + CALIBRATION_MS;
    return { stats, speedKmh: state.smoothedKmh, accepted: false, calibrating: true };
  }

  const dm = haversine(prev, fix);
  // 2) Konum belirsizliğinden küçük hareketler = gürültü (durakta bekleme)
  // #4: taban üst sınırlı; GPS hızı hareketi teyit ediyorsa taban esnetilir.
  const gpsMoving = gps != null && gps >= GPS_MOVE_CONFIRM_KMH;
  const rawFloor = (fix.accuracy + prev.accuracy) * (weakFix ? 0.6 : 0.4);
  const noiseFloor = Math.min(
    MAX_NOISE_FLOOR_M,
    Math.max(4, gpsMoving ? rawFloor * 0.5 : rawFloor),
  );
  if (dm < noiseFloor && !gpsMoving) {
    state.lastFix = fix;
    // #8: zaman tabanlı sönüm
    const decay = 1 - Math.exp(-dt / SPEED_TAU_S);
    state.smoothedKmh = state.smoothedKmh * (1 - decay);
    if (state.smoothedKmh < IDLE_KMH) state.smoothedKmh = 0;
    state.fastStreak = 0;
    return reject();
  }

  const segKmh = (dm / dt) * 3.6;
  // 3) İmkânsız hız = GPS zıplaması
  if (segKmh > MAX_PLAUSIBLE_KMH) {
    state.lastFix = fix;
    return reject();
  }

  // 4) #7: hızlanmada GPS Doppler hızı daha doğrudur. GPS varsa onu baz al;
  //    segment hızı yalnızca tutarlılık kontrolü için kullanılır.
  const gpsConsistent = gps != null && Math.abs(gps - segKmh) <= Math.max(12, segKmh * 0.5);
  let measured: number;
  if (gps != null && (gpsConsistent || gps > segKmh)) measured = gps;
  else if (gps != null) measured = (gps + segKmh) / 2;
  else measured = segKmh;

  // #3: asimetrik ivme kapısı (fren için daha geniş)
  const delta = measured - state.smoothedKmh;
  const rate = Math.abs(delta) / dt;
  const limit = delta >= 0 ? MAX_ACCEL_KMH_PER_S : MAX_DECEL_KMH_PER_S;
  if (state.smoothedKmh > 0 && rate > limit && !calibrating()) {
    // Tamamen atmak yerine kapıya kadar yaklaştır: hız kilitlenmesin.
    measured = state.smoothedKmh + Math.sign(delta) * limit * dt;
  }

  // #8: zaman tabanlı EMA
  const alpha = 1 - Math.exp(-dt / SPEED_TAU_S);
  state.smoothedKmh = state.smoothedKmh
    ? state.smoothedKmh + (measured - state.smoothedKmh) * alpha
    : measured;
  if (state.smoothedKmh < IDLE_KMH) state.smoothedKmh = 0;

  // 5) Zirve hız: iyi fix'te 2 doğrulanmış ölçüm yeter.
  //    #9: zayıf fix'te de GPS hızı segment hızını teyit ediyorsa zirve güncellenir.
  state.fastStreak = measured > stats.maxSpeedKmh ? state.fastStreak + 1 : 0;
  const gpsConfirms = gps != null && Math.abs(gps - segKmh) < 8;
  const peakOk = weakFix
    ? gpsConfirms && state.fastStreak >= 2
    : state.fastStreak >= 2 || (gpsConfirms && state.fastStreak >= 1);
  const nextMax = peakOk ? Math.min(measured, MAX_PLAUSIBLE_KMH) : stats.maxSpeedKmh;

  // Bulgu 11: yalnızca fiilî hareket süresi sayılır
  const movingDelta = measured >= IDLE_KMH ? dt : 0;

  const next: TripStats = {
    totalMeters: stats.totalMeters + dm,
    movingSeconds: stats.movingSeconds + movingDelta,
    maxSpeedKmh: Math.max(stats.maxSpeedKmh, nextMax),
    startedAt: stats.startedAt || fix.ts,
    updatedAt: fix.ts,
  };
  state.lastFix = fix;
  return { stats: next, speedKmh: state.smoothedKmh, accepted: true, calibrating: calibrating() };
}

/** Bulgu 13: GPS doğruluğunu kullanıcıya anlatan kısa etiket. */
export function accuracyLabel(accuracy: number | null | undefined): {
  text: string;
  level: "iyi" | "zayıf" | "kötü";
} {
  if (accuracy == null || !isFinite(accuracy)) return { text: "GPS bekleniyor", level: "kötü" };
  if (accuracy <= GOOD_ACCURACY_M) return { text: `GPS ±${Math.round(accuracy)} m`, level: "iyi" };
  if (accuracy <= MAX_ACCURACY_M)
    return { text: `GPS zayıf ±${Math.round(accuracy)} m`, level: "zayıf" };
  return { text: `GPS sinyali kötü ±${Math.round(accuracy)} m`, level: "kötü" };
}

export { GOOD_ACCURACY_M, MAX_ACCURACY_M, MAX_DT, IDLE_KMH };
