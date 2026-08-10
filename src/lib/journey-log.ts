// Günlük hareket kaydı - IndexedDB (şoför cihazında kalıcı)
// 7. madde: kontak (Battery API şarj durumu) ile hareket saatleri
// + her durağa saat/dakika/saniye cinsinden varış kaydı (8. madde düzenlilik skoru için)

export interface IgnitionSession {
  start: number; // ms epoch
  end: number | null; // null = devam ediyor
}

export interface StopArrival {
  stopId: string;
  name: string;
  ts: number; // ms epoch
}

export interface DayLog {
  date: string; // YYYY-MM-DD
  sessions: IgnitionSession[];
  arrivals: StopArrival[];
  /** O gün kat edilen mesafe (metre) */
  meters?: number;
  /** O gün fiilen hareket halinde geçen süre (saniye, hız > 5 km/s) */
  drivingSeconds?: number;
  updatedAt: number;
}

const DB_NAME = "acrob-journey-log";
const STORE = "days";

export function todayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const emptyDay = (date = todayKey()): DayLog => ({
  date,
  sessions: [],
  arrivals: [],
  meters: 0,
  drivingSeconds: 0,
  updatedAt: Date.now(),
});

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: "date" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadDay(date = todayKey()): Promise<DayLog> {
  try {
    const db = await openDb();
    return await new Promise<DayLog>((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(date);
      req.onsuccess = () => resolve((req.result as DayLog) ?? emptyDay(date));
      req.onerror = () => resolve(emptyDay(date));
    });
  } catch {
    return emptyDay(date);
  }
}

export async function saveDay(day: DayLog): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put({ ...day, updatedAt: Date.now() });
  } catch {
    /* ignore */
  }
}

export async function listDays(limit = 14): Promise<DayLog[]> {
  try {
    const db = await openDb();
    return await new Promise<DayLog[]>((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () =>
        resolve(
          ((req.result as DayLog[]) ?? [])
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, limit),
        );
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function clearDay(date = todayKey()): Promise<DayLog> {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(date);
  } catch {
    /* ignore */
  }
  return emptyDay(date);
}

// ---------- biçimlendirme ----------
export function clockOf(ts: number): string {
  return new Date(ts).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// ---------- hesaplar ----------
export function sessionSeconds(s: IgnitionSession, now = Date.now()): number {
  return Math.max(0, ((s.end ?? now) - s.start) / 1000);
}

export function totalMovingSeconds(day: DayLog, now = Date.now()): number {
  return day.sessions.reduce((a, s) => a + sessionSeconds(s, now), 0);
}

/** Seferler arası duruşlar (mola süreleri) */
export function breakSeconds(day: DayLog): number[] {
  const out: number[] = [];
  for (let i = 1; i < day.sessions.length; i++) {
    const prevEnd = day.sessions[i - 1]!.end;
    if (prevEnd) out.push(Math.max(0, (day.sessions[i]!.start - prevEnd) / 1000));
  }
  return out;
}

export function firstStart(day: DayLog): number | null {
  return day.sessions.length ? day.sessions[0]!.start : null;
}

export function lastEnd(day: DayLog): number | null {
  const last = day.sessions[day.sessions.length - 1];
  return last ? last.end : null;
}

// ---------- kontak (hareket) kaydı ----------
export function openSession(day: DayLog, ts = Date.now()): DayLog {
  const last = day.sessions[day.sessions.length - 1];
  if (last && last.end === null) return day; // zaten açık
  return { ...day, sessions: [...day.sessions, { start: ts, end: null }] };
}

export function closeSession(day: DayLog, ts = Date.now()): DayLog {
  const sessions = [...day.sessions];
  const last = sessions[sessions.length - 1];
  if (!last || last.end !== null) return day;
  sessions[sessions.length - 1] = { ...last, end: ts };
  return { ...day, sessions };
}

/** Aynı durağa gün içinde tek kayıt (ilk varış saati). */
export function recordArrival(day: DayLog, stopId: string, name: string, ts = Date.now()): DayLog {
  if (day.arrivals.some((a) => a.stopId === stopId)) return day;
  return { ...day, arrivals: [...day.arrivals, { stopId, name, ts }] };
}

/** Yolculara gönderilen paket */
export interface JourneyPayload {
  type: "journey";
  day: DayLog;
  ts: number;
}

export const ARRIVAL_RADIUS_M = 100;

/** Sürüş verisi biriktir (mesafe + fiili hareket süresi). */
export function addDriving(day: DayLog, meters: number, seconds: number): DayLog {
  return {
    ...day,
    meters: (day.meters ?? 0) + Math.max(0, meters),
    drivingSeconds: (day.drivingSeconds ?? 0) + Math.max(0, seconds),
  };
}

// ---------- 8. madde: kurumsal rapor hesapları ----------
export interface DayReport {
  date: string;
  km: number;
  ignitionSeconds: number; // kontak açık toplam süre
  drivingSeconds: number; // fiilen hareket
  idleSeconds: number; // rölanti (kontak açık ama hareketsiz)
  avgSpeedKmh: number;
  trips: number;
  breakSeconds: number;
  arrivals: StopArrival[];
  firstStart: number | null;
}

export function dayReport(day: DayLog, now = Date.now()): DayReport {
  const ignition = totalMovingSeconds(day, now);
  const driving = Math.min(day.drivingSeconds ?? 0, ignition || (day.drivingSeconds ?? 0));
  const km = (day.meters ?? 0) / 1000;
  return {
    date: day.date,
    km,
    ignitionSeconds: ignition,
    drivingSeconds: driving,
    idleSeconds: Math.max(0, ignition - driving),
    avgSpeedKmh: driving > 30 ? km / (driving / 3600) : 0,
    trips: day.sessions.length,
    breakSeconds: breakSeconds(day).reduce((a, b) => a + b, 0),
    arrivals: day.arrivals,
    firstStart: firstStart(day),
  };
}

/** Günün başından itibaren saniye cinsinden saat (00:00 = 0) */
export function secondsOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

export interface PunctualityStop {
  stopId: string;
  name: string;
  medianSeconds: number;
  samples: number;
  deviationSeconds: number; // ortalama mutlak sapma
  score: number; // 0-100
}

export interface PunctualityReport {
  score: number; // 0-100 genel düzenlilik
  stops: PunctualityStop[];
}

function median(list: number[]): number {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : ((s[m - 1]! + s[m]!) / 2);
}

/**
 * Düzenlilik skoru: her durağın varış saatinin günler arası sapması.
 * 0 sn sapma = 100 puan, 15 dk ve üzeri sapma = 0 puan.
 */
export function punctuality(days: DayLog[]): PunctualityReport {
  const byStop = new Map<string, { name: string; times: number[] }>();
  days.forEach((d) =>
    d.arrivals.forEach((a) => {
      const cur = byStop.get(a.stopId) ?? { name: a.name, times: [] };
      cur.times.push(secondsOfDay(a.ts));
      byStop.set(a.stopId, cur);
    }),
  );
  const MAX_DEV = 15 * 60;
  const stops: PunctualityStop[] = [];
  byStop.forEach((v, stopId) => {
    const med = median(v.times);
    const dev = v.times.reduce((a, t) => a + Math.abs(t - med), 0) / v.times.length;
    stops.push({
      stopId,
      name: v.name,
      medianSeconds: med,
      samples: v.times.length,
      deviationSeconds: dev,
      score: Math.round(Math.max(0, 1 - dev / MAX_DEV) * 100),
    });
  });
  stops.sort((a, b) => a.medianSeconds - b.medianSeconds);
  const scored = stops.filter((s) => s.samples >= 2);
  const score = scored.length
    ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length)
    : 0;
  return { score, stops };
}

/** Saniye-of-day → HH:MM:SS */
export function clockOfSeconds(sec: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = Math.max(0, Math.round(sec));
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
