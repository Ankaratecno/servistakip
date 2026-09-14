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
  ts: number; // ms epoch (ilk varış)
  /** Durak alanında son görüldüğü an (bekleme süresi hesabı) */
  lastSeen?: number;
  /** Durak alanında geçirilen toplam süre (saniye) */
  dwellSeconds?: number;
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
    db.transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put({ ...day, updatedAt: Date.now() });
  } catch {
    /* ignore */
  }
}

// YAPILACAKLAR3 #43: her GPS fix'inde IndexedDB'ye yazmak batarya ve disk
// yıpratıyordu. Yazımlar toplanır, en fazla 5 sn'de bir diske işlenir;
// sayfa gizlenince / kapanınca anında boşaltılır.
const FLUSH_MS = 5000;
let pending: DayLog | null = null;
let flushTimer: number | null = null;

export function saveDayBatched(day: DayLog): void {
  pending = day;
  if (flushTimer !== null) return;
  flushTimer = (globalThis.setTimeout as typeof setTimeout)(() => {
    flushTimer = null;
    void flushDay();
  }, FLUSH_MS) as unknown as number;
}

export async function flushDay(): Promise<void> {
  const day = pending;
  pending = null;
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (day) await saveDay(day);
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

/** Durak alanında iki fix arası en fazla bu kadar boşluk bekleme sayılır (ms). */
const DWELL_GAP_MS = 5 * 60 * 1000;

/**
 * Aynı durağa gün içinde tek varış kaydı (ilk varış saati) + durak alanında
 * kalınan süre (bekleme). Araç radyus içindeyken her fix'te çağrılır.
 */
export function recordArrival(day: DayLog, stopId: string, name: string, ts = Date.now()): DayLog {
  const idx = day.arrivals.findIndex((a) => a.stopId === stopId);
  if (idx === -1)
    return {
      ...day,
      arrivals: [...day.arrivals, { stopId, name, ts, lastSeen: ts, dwellSeconds: 0 }],
    };
  const cur = day.arrivals[idx]!;
  const last = cur.lastSeen ?? cur.ts;
  const gap = ts - last;
  if (gap <= 0) return day;
  const arrivals = [...day.arrivals];
  arrivals[idx] = {
    ...cur,
    lastSeen: ts,
    dwellSeconds: (cur.dwellSeconds ?? 0) + (gap <= DWELL_GAP_MS ? gap / 1000 : 0),
  };
  return { ...day, arrivals };
}

/** Yolculara gönderilen tam anlık görüntü (yalnızca ilk bağlantıda / periyodik senkron) */
export interface JourneyPayload {
  type: "journey";
  day: DayLog;
  ts: number;
}

/**
 * YAPILACAKLAR3 #41: tüm DayLog'u her değişimde göndermek yerine yalnızca
 * değişen alanlar gönderilir (veri kullanımı ~10-50 kat azalır).
 */
export interface JourneyDeltaPayload {
  type: "journey-delta";
  date: string;
  meters?: number;
  drivingSeconds?: number;
  /** Yalnızca yeni eklenen varışlar */
  arrivals?: StopArrival[];
  /** Oturum listesi değiştiyse (kontak aç/kapa) tam liste — küçüktür */
  sessions?: IgnitionSession[];
  ts: number;
}

/** Delta paketini yolcu tarafındaki güne uygular. */
export function applyDelta(day: DayLog | null, d: JourneyDeltaPayload): DayLog {
  const base = day && day.date === d.date ? day : emptyDay(d.date);
  const known = new Set(base.arrivals.map((a) => a.stopId));
  const arrivals = d.arrivals?.length
    ? [...base.arrivals, ...d.arrivals.filter((a) => !known.has(a.stopId))]
    : base.arrivals;
  return {
    ...base,
    meters: d.meters ?? base.meters,
    drivingSeconds: d.drivingSeconds ?? base.drivingSeconds,
    sessions: d.sessions ?? base.sessions,
    arrivals,
    updatedAt: d.ts,
  };
}

/** İki gün kaydı arasındaki farkı üretir; fark yoksa null döner. */
export function diffDay(prev: DayLog | null, next: DayLog): JourneyDeltaPayload | null {
  const delta: JourneyDeltaPayload = { type: "journey-delta", date: next.date, ts: Date.now() };
  let changed = false;
  if (!prev || prev.date !== next.date) return null; // gün değişti → tam paket gerekir
  if ((prev.meters ?? 0) !== (next.meters ?? 0)) {
    delta.meters = next.meters;
    changed = true;
  }
  if ((prev.drivingSeconds ?? 0) !== (next.drivingSeconds ?? 0)) {
    delta.drivingSeconds = next.drivingSeconds;
    changed = true;
  }
  if (next.arrivals.length > prev.arrivals.length) {
    delta.arrivals = next.arrivals.slice(prev.arrivals.length);
    changed = true;
  }
  const sameSessions =
    prev.sessions.length === next.sessions.length &&
    prev.sessions.every(
      (s, i) => s.start === next.sessions[i]?.start && s.end === next.sessions[i]?.end,
    );
  if (!sameSessions) {
    delta.sessions = next.sessions;
    changed = true;
  }
  return changed ? delta : null;
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

export interface PunctualityDay {
  date: string;
  seconds: number; // varış saati (saniye-of-day)
  deltaSeconds: number; // referans saatten sapma (mutlak)
  dwellSeconds: number;
  score: number;
}

export interface PunctualityStop {
  stopId: string;
  name: string;
  medianSeconds: number;
  samples: number;
  deviationSeconds: number; // ortalama mutlak sapma
  avgDwellSeconds: number;
  score: number; // 0-100
  days: PunctualityDay[];
}

export interface PunctualityReport {
  score: number; // 0-100 genel düzenlilik
  stops: PunctualityStop[];
}

function median(list: number[]): number {
  const s = [...list].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Tek bir varışın puanı: durağın kendi ortalama (medyan) saatinden sapma.
 * ≤2 dk = 100 · ≤5 dk = 95 · ≤10 dk = 85 · ≤15 dk = 70 · ≤30 dk = 40 · üstü = 0
 */
export function arrivalScore(deltaSeconds: number): number {
  const m = Math.abs(deltaSeconds) / 60;
  if (m <= 2) return 100;
  if (m <= 5) return 95;
  if (m <= 10) return 85;
  if (m <= 15) return 70;
  if (m <= 30) return 40;
  return 0;
}

/** Düzenlilik skoru: her durak kendi ortalama varış saatine göre puanlanır. */
export function punctuality(days: DayLog[]): PunctualityReport {
  const byStop = new Map<
    string,
    { name: string; rows: { date: string; seconds: number; dwellSeconds: number }[] }
  >();
  days.forEach((d) =>
    d.arrivals.forEach((a) => {
      const cur = byStop.get(a.stopId) ?? { name: a.name, rows: [] };
      cur.name = a.name;
      cur.rows.push({
        date: d.date,
        seconds: secondsOfDay(a.ts),
        dwellSeconds: Math.round(a.dwellSeconds ?? 0),
      });
      byStop.set(a.stopId, cur);
    }),
  );
  const stops: PunctualityStop[] = [];
  byStop.forEach((v, stopId) => {
    const times = v.rows.map((r) => r.seconds);
    const med = median(times);
    const dev = times.reduce((a, t) => a + Math.abs(t - med), 0) / times.length;
    const dayRows: PunctualityDay[] = v.rows
      .map((r) => ({
        date: r.date,
        seconds: r.seconds,
        deltaSeconds: Math.round(Math.abs(r.seconds - med)),
        dwellSeconds: r.dwellSeconds,
        score: arrivalScore(r.seconds - med),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    stops.push({
      stopId,
      name: v.name,
      medianSeconds: med,
      samples: times.length,
      deviationSeconds: dev,
      avgDwellSeconds: Math.round(
        v.rows.reduce((a, r) => a + r.dwellSeconds, 0) / Math.max(1, v.rows.length),
      ),
      score: Math.round(dayRows.reduce((a, r) => a + r.score, 0) / dayRows.length),
      days: dayRows,
    });
  });
  stops.sort((a, b) => a.medianSeconds - b.medianSeconds);
  const scored = stops.filter((s) => s.samples >= 2);
  const score = scored.length
    ? Math.round(scored.reduce((a, s) => a + s.score, 0) / scored.length)
    : 0;
  return { score, stops };
}

// ---------- bakım ----------
/** 30 günden (varsayılan) eski kayıtları siler; kalan gün sayısını döner. */
export async function pruneDays(keepDays = 30): Promise<number> {
  const all = await listDays(9999);
  const cutoff = todayKey(new Date(Date.now() - keepDays * 86400000));
  const old = all.filter((d) => d.date < cutoff);
  if (old.length) {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE, "readwrite");
      old.forEach((d) => tx.objectStore(STORE).delete(d.date));
    } catch {
      /* ignore */
    }
  }
  return all.length - old.length;
}

/** Tüm günlük kayıtları siler (sıfırla). */
export async function clearAllDays(): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).clear();
  } catch {
    /* ignore */
  }
}

// ---------- CSV dışa aktarma ----------
function csvCell(v: string | number): string {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvOf(rows: (string | number)[][]): string {
  // Excel (TR) ayırıcı olarak noktalı virgül bekler
  return `\uFEFF${rows.map((r) => r.map(csvCell).join(";")).join("\r\n")}`;
}

/** Günlük özet + durak bazlı varış/bekleme kayıtlarını tek CSV'de üretir. */
export function daysToCsv(days: DayLog[]): string {
  const rows: (string | number)[][] = [
    ["GÜNLÜK ÖZET"],
    [
      "Tarih",
      "KM",
      "Kontak Açık",
      "Hareket",
      "Rölanti",
      "Ort. Hız (km/s)",
      "Sefer",
      "Mola",
      "Durak Sayısı",
      "İlk Hareket",
    ],
  ];
  const sorted = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));
  sorted.forEach((d) => {
    const r = dayReport(d);
    rows.push([
      r.date,
      r.km.toFixed(2).replace(".", ","),
      fmtDuration(r.ignitionSeconds),
      fmtDuration(r.drivingSeconds),
      fmtDuration(r.idleSeconds),
      Math.round(r.avgSpeedKmh),
      r.trips,
      fmtDuration(r.breakSeconds),
      r.arrivals.length,
      r.firstStart ? clockOf(r.firstStart) : "-",
    ]);
  });

  const punct = punctuality(sorted);
  rows.push([], ["DURAK BAZLI VARIŞ / BEKLEME"]);
  rows.push(["Tarih", "Durak", "Varış Saati", "Bekleme Süresi", "Ortalama Saat", "Sapma", "Puan"]);
  punct.stops.forEach((s) =>
    s.days.forEach((d) =>
      rows.push([
        d.date,
        s.name,
        clockOfSeconds(d.seconds),
        fmtDuration(d.dwellSeconds),
        clockOfSeconds(s.medianSeconds),
        fmtDuration(d.deltaSeconds),
        d.score,
      ]),
    ),
  );

  rows.push([], ["DURAK DÜZENLİLİK SKORU"]);
  rows.push(["Durak", "Ortalama Saat", "Gün Sayısı", "Ort. Sapma", "Ort. Bekleme", "Puan"]);
  punct.stops.forEach((s) =>
    rows.push([
      s.name,
      clockOfSeconds(s.medianSeconds),
      s.samples,
      fmtDuration(s.deviationSeconds),
      fmtDuration(s.avgDwellSeconds),
      s.score,
    ]),
  );
  rows.push([], ["GENEL DÜZENLİLİK SKORU", punct.score]);
  return csvOf(rows);
}

/** Tarayıcıda dosya indirir. */
export function downloadFile(name: string, content: string, mime = "text/csv;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
