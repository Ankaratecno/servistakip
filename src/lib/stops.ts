// Durak yönetimi - localStorage tabanlı (admin panelinden düzenlenir)
export type StopKind = "stop" | "waypoint";

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  order: number;
  // "stop" = yolcunun seçebileceği gerçek durak
  // "waypoint" = sadece rotayı şekillendiren ara nokta (yolcuya gösterilmez)
  kind: StopKind;
  // false = güzergâhta kullanılmaz (admin panelinde tiki kaldırılmış)
  active: boolean;
}

const KEY = "acrob-stops-v15";

// Sabit güzergâh — duraklar + ELOKTROLAND fabrika, aradaki ROTA noktaları OSRM'in
// yol takibi için ipucu görevi görür.
// active:false olan eski ROTA noktaları yedekte durur; 1. yolcu servise binmediği
// günlerde admin panelinden tiklenip yeniler pasife alınabilir.
const SEED: Array<Omit<Stop, "id" | "order" | "active"> & { active?: boolean }> = [
  { name: "ROTA", lat: 39.9485, lng: 32.6681, kind: "waypoint" },
  { name: "ROTA", lat: 39.9643, lng: 32.6355, kind: "waypoint", active: false },
  { name: "ROTA", lat: 39.96957, lng: 32.61275, kind: "waypoint", active: false },
  { name: "ROTA", lat: 39.981263, lng: 32.571191, kind: "waypoint", active: false },
  { name: "ROTA", lat: 39.958, lng: 32.6214, kind: "waypoint" },
  { name: "ROTA", lat: 39.9611, lng: 32.6035, kind: "waypoint" },
  { name: "1.DURAK", lat: 39.966, lng: 32.6031, kind: "stop" },
  { name: "2.DURAK", lat: 39.99583, lng: 32.57631, kind: "stop" },
  { name: "ROTA", lat: 39.9955, lng: 32.5803, kind: "waypoint" },
  { name: "ROTA", lat: 39.996389, lng: 32.585908, kind: "waypoint" },
  { name: "ROTA", lat: 39.9946, lng: 32.5881, kind: "waypoint" },
  { name: "ROTA", lat: 39.9969, lng: 32.6024, kind: "waypoint" },
  { name: "3.DURAK", lat: 39.9982, lng: 32.6217, kind: "stop" },
  { name: "ROTA", lat: 39.992864, lng: 32.622163, kind: "waypoint" },
  { name: "4.DURAK", lat: 39.9907, lng: 32.6395, kind: "stop" },
  { name: "ROTA", lat: 39.985991, lng: 32.645096, kind: "waypoint" },
  { name: "5.DURAK", lat: 39.981285, lng: 32.64852, kind: "stop" },
  { name: "6.DURAK", lat: 39.9396, lng: 32.624, kind: "stop" },
  { name: "7.DURAK", lat: 39.8674, lng: 32.6387, kind: "stop" },
  { name: "8.DURAK", lat: 39.870005, lng: 32.642608, kind: "stop" },
  { name: "9.DURAK", lat: 39.775938, lng: 32.672799, kind: "stop" },
  { name: "25 SAAT FIRIN", lat: 39.801592, lng: 32.804863, kind: "stop" },
  { name: "ELOKTROLAND", lat: 39.741392, lng: 32.809128, kind: "stop" },
];

const DEFAULT_STOPS: Stop[] = SEED.map((s, i) => ({
  ...s,
  id: `seed-${i + 1}`,
  order: i + 1,
  active: s.active ?? true,
}));

export function getStops(): Stop[] {
  if (typeof window === "undefined") return DEFAULT_STOPS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STOPS;
    const parsed = JSON.parse(raw) as Stop[];
    // Eski kayıtlarda kind/active yoksa varsayılanları uygula
    return parsed
      .map((s) => ({
        ...s,
        kind: (s.kind ?? "stop") as StopKind,
        active: s.active !== false,
      }))
      .sort((a, b) => a.order - b.order);
  } catch {
    return DEFAULT_STOPS;
  }
}

/** Güzergâhta gerçekten kullanılan (tikli) noktalar. */
export function getActiveStops(): Stop[] {
  return getStops().filter((s) => s.active);
}

export function saveStops(stops: Stop[]) {
  localStorage.setItem(KEY, JSON.stringify(stops));
}

export function addStop(
  stop: Omit<Stop, "id" | "order" | "kind" | "active"> & { kind?: StopKind },
): Stop[] {
  const stops = getStops();
  const newStop: Stop = {
    ...stop,
    id: `s${Date.now()}`,
    order: stops.length + 1,
    kind: stop.kind ?? "stop",
    active: true,
  };
  const updated = [...stops, newStop];
  saveStops(updated);
  return updated;
}

export function deleteStop(id: string): Stop[] {
  const stops = getStops().filter((s) => s.id !== id);
  const reordered = stops.map((s, i) => ({ ...s, order: i + 1 }));
  saveStops(reordered);
  return reordered;
}

export function moveStop(id: string, direction: "up" | "down"): Stop[] {
  const stops = getStops();
  const idx = stops.findIndex((s) => s.id === id);
  if (idx === -1) return stops;
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= stops.length) return stops;
  [stops[idx], stops[swap]] = [stops[swap], stops[idx]];
  const reordered = stops.map((s, i) => ({ ...s, order: i + 1 }));
  saveStops(reordered);
  return reordered;
}

export function toggleStopKind(id: string): Stop[] {
  const stops: Stop[] = getStops().map((s) =>
    s.id === id ? { ...s, kind: (s.kind === "stop" ? "waypoint" : "stop") as StopKind } : s,
  );
  saveStops(stops);
  return stops;
}

/** Noktayı güzergâha dahil et / güzergâhtan çıkar (admin panelindeki kare kutu). */
export function toggleStopActive(id: string): Stop[] {
  const stops: Stop[] = getStops().map((s) => (s.id === id ? { ...s, active: !s.active } : s));
  saveStops(stops);
  return stops;
}

/** Durak adını ve/veya konumunu güncelle (admin panelindeki düzenleme). */
export function updateStop(
  id: string,
  patch: { name?: string; lat?: number; lng?: number },
): Stop[] {
  const stops: Stop[] = getStops().map((s) =>
    s.id === id
      ? {
          ...s,
          name: patch.name !== undefined ? patch.name : s.name,
          lat: patch.lat !== undefined ? patch.lat : s.lat,
          lng: patch.lng !== undefined ? patch.lng : s.lng,
        }
      : s,
  );
  saveStops(stops);
  return stops;
}
