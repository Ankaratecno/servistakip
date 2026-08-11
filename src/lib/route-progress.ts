// YAPILACAKLAR3 D bölümü (32–37): uyarı mesafesi ve zamanlaması.
// Kuş uçuşu mesafe yerine güzergâh çizgisi üzerinden ölçüm, yön (bearing)
// kontrolü, hıza göre dinamik eşik ve "sıradaki durak" seçimi burada toplanır.

import type { Stop } from "@/lib/stops";
import { haversineM } from "@/lib/routing";

export interface LatLng {
  lat: number;
  lng: number;
}

/** İki nokta arası yön (0–360, kuzeyden saat yönü). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** İki yön arası en kısa açı farkı (0–180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

/**
 * #32: Güzergâh çizgisi üzerinden yol mesafesi.
 * Araca en yakın rota noktasından hedefe en yakın rota noktasına kadar
 * çizgi boyu toplanır. Araç rotadan 150 m'den uzaksa (sapma) null döner.
 */
export function routeDistanceToPoint(
  path: [number, number][] | null | undefined,
  pos: LatLng | null | undefined,
  target: LatLng,
): number | null {
  if (!path || path.length < 2 || !pos) return null;
  let posIdx = 0;
  let posD = Infinity;
  let tgtIdx = 0;
  let tgtD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const node = { lat: p[0], lng: p[1] };
    const dp = haversineM(pos, node);
    if (dp < posD) {
      posD = dp;
      posIdx = i;
    }
    const dt = haversineM(target, node);
    if (dt < tgtD) {
      tgtD = dt;
      tgtIdx = i;
    }
  }
  if (posD > 150) return null;
  if (tgtIdx <= posIdx) return haversineM(pos, target);
  let sum = posD;
  for (let i = posIdx; i < tgtIdx; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    sum += haversineM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
  }
  return sum + tgtD;
}

/**
 * Uyarı için kullanılacak mesafe: yol mesafesi varsa o, yoksa kuş uçuşu.
 * Yol mesafesi hiçbir zaman kuş uçuşundan kısa olamaz.
 */
export function effectiveDistanceM(
  path: [number, number][] | null | undefined,
  pos: LatLng,
  target: LatLng,
): number {
  const straight = haversineM(pos, target);
  const along = routeDistanceToPoint(path, pos, target);
  if (along == null || !isFinite(along)) return straight;
  return Math.max(straight, along);
}

/** #37: değerlendirilecek tek durak — sıradaki gerçek durak. */
export function nextStop(stops: Stop[], passed: Set<string>): Stop | null {
  for (const s of stops) {
    if ((s.kind ?? "stop") !== "stop") continue;
    if (passed.has(s.id)) continue;
    return s;
  }
  return null;
}

// ---------- #34: yön / yaklaşma eğilimi ----------

export interface TrendState {
  stopId: string | null;
  lastM: number | null;
  /** üst üste uzaklaşma sayacı */
  away: number;
}

export const initialTrendState = (): TrendState => ({ stopId: null, lastM: null, away: 0 });

/**
 * Mesafe eğilimine bakar: servis duraktan uzaklaşıyorsa false döner.
 * İlk ölçümde (bilinmiyor) true kabul edilir.
 */
export function ingestTrend(state: TrendState, stopId: string, distanceM: number): boolean {
  if (state.stopId !== stopId) {
    state.stopId = stopId;
    state.lastM = distanceM;
    state.away = 0;
    return true;
  }
  const prev = state.lastM;
  state.lastM = distanceM;
  if (prev == null) return true;
  if (distanceM > prev + 12) state.away += 1;
  else if (distanceM < prev - 5) state.away = 0;
  return state.away < 3;
}

/** Yön (heading) verisi varsa duraktan uzaklaşan hareketi ayıklar. */
export function headingAgrees(
  heading: number | null | undefined,
  pos: LatLng,
  target: LatLng,
  speedKmh: number,
): boolean {
  if (heading == null || !isFinite(heading) || speedKmh < 8) return true;
  return angleDiff(heading, bearingDeg(pos, target)) <= 110;
}

// ---------- #33/#35: ETA ve dinamik eşik ----------

/** Uyarı için kullanılacak hız (km/s): anlık hız düşükse ortalamaya döner. */
export function paceKmh(speedKmh: number, avgKmh?: number | null): number {
  const avg = avgKmh != null && isFinite(avgKmh) && avgKmh > 5 ? avgKmh : 25;
  return speedKmh > 6 ? speedKmh : avg;
}

/** Mesafeden yerel ETA (saniye) — OSRM yoksa yedek hesap (#39). */
export function etaSeconds(distanceM: number, speedKmh: number, avgKmh?: number | null): number {
  const kmh = Math.max(6, paceKmh(speedKmh, avgKmh));
  return (distanceM / 1000 / kmh) * 3600;
}

/** #35: hıza göre dinamik anons eşiği — sabit 350 m yerine ~25 sn'lik yol. */
export const ANNOUNCE_LEAD_S = 25;

export function announceDistanceM(speedKmh: number, avgKmh?: number | null): number {
  const kmh = paceKmh(speedKmh, avgKmh);
  const m = (kmh / 3.6) * ANNOUNCE_LEAD_S;
  return Math.min(700, Math.max(150, m));
}
