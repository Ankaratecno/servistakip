import { OSRM_BASE } from "./service-config";

export interface RouteResult {
  path: [number, number][]; // [lat, lng]
  distanceM: number;
  durationS: number;
}

// OSRM üzerinden çoklu-nokta rota hesapla
export async function getRoute(
  points: { lat: number; lng: number }[],
): Promise<RouteResult | null> {
  if (points.length < 2) return null;
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.routes?.[0];
    if (!r) return null;
    const path: [number, number][] = r.geometry.coordinates.map(([lng, lat]: [number, number]) => [
      lat,
      lng,
    ]);
    return { path, distanceM: r.distance, durationS: r.duration };
  } catch {
    return null;
  }
}

// Servis konumundan hedef durağa ETA (saniye)
export async function getEta(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<{ durationS: number; distanceM: number } | null> {
  const url = `${OSRM_BASE}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const r = data.routes?.[0];
    if (!r) return null;
    return { durationS: r.duration, distanceM: r.distance };
  } catch {
    return null;
  }
}

export function formatEta(seconds: number): { minutes: number; secs: number; text: string } {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  const text = minutes > 0 ? `${minutes} dakika ${secs} saniye` : `${secs} saniye`;
  return { minutes, secs, text };
}

// İki nokta arası kuş uçuşu mesafe (metre)
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Her gerçek durakta yolcu alma/indirme için ortalama bekleme (saniye)
export const DWELL_SECONDS_PER_STOP = 45;

export interface RouteEtaResult {
  durationS: number;
  distanceM: number;
  viaStops: number; // hedeften önce uğranacak durak sayısı
  dwellS: number;
}

/**
 * Güzergâha sadık ETA: servis konumundan hedefe kadar aradaki TÜM
 * durak/rota noktalarından geçerek hesaplar ve ara duraklardaki
 * bekleme sürelerini ekler. Kuş uçuşu / doğrudan rota kullanılmaz.
 */
export async function getRouteEta(
  from: { lat: number; lng: number },
  allPoints: { lat: number; lng: number; kind?: string; id?: string }[],
  targetId: string,
): Promise<RouteEtaResult | null> {
  const targetIdx = allPoints.findIndex((p) => p.id === targetId);
  if (targetIdx === -1) return null;

  // Servisin güzergâhta bulunduğu en yakın nokta
  let nearestIdx = 0;
  let best = Infinity;
  allPoints.forEach((p, i) => {
    const d = haversineM(from, p);
    if (d < best) {
      best = d;
      nearestIdx = i;
    }
  });

  // Hedef geride kaldıysa doğrudan hesap
  const startIdx = Math.min(nearestIdx + 1, targetIdx);
  const between = targetIdx >= startIdx ? allPoints.slice(startIdx, targetIdx) : [];
  const waypoints = [from, ...between, allPoints[targetIdx]!];

  const r = await getRoute(waypoints);
  if (!r) return null;

  const viaStops = between.filter((p) => (p.kind ?? "stop") === "stop").length;
  const dwellS = viaStops * DWELL_SECONDS_PER_STOP;
  return {
    durationS: r.durationS + dwellS,
    distanceM: r.distanceM,
    viaStops,
    dwellS,
  };
}
