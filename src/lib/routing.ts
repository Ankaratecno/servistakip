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
