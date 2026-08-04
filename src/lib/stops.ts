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
}

const KEY = "acrob-stops-v10";

// Sabit güzergâh — 8 durak + ELOKTROLAND fabrika, aradaki ROTA noktaları OSRM'in
// yol takibi için ipucu görevi görür.
const SEED: Array<Omit<Stop, "id" | "order">> = [
  { name: "ROTA", lat: 39.9485, lng: 32.6681, kind: "waypoint" },
  { name: "ROTA", lat: 39.9643, lng: 32.6355, kind: "waypoint" },
  { name: "ROTA", lat: 39.96957, lng: 32.61275, kind: "waypoint" },
  { name: "ROTA", lat: 39.981263, lng: 32.571191, kind: "waypoint" },
  { name: "1.DURAK", lat: 39.9958, lng: 32.5764, kind: "stop" },
  { name: "ROTA", lat: 39.9955, lng: 32.5803, kind: "waypoint" },
  { name: "ROTA", lat: 39.996389, lng: 32.585908, kind: "waypoint" },
  { name: "ROTA", lat: 39.9946, lng: 32.5881, kind: "waypoint" },
  { name: "ROTA", lat: 39.9969, lng: 32.6024, kind: "waypoint" },
  { name: "2.DURAK", lat: 39.9982, lng: 32.6217, kind: "stop" },
  { name: "ROTA", lat: 39.992864, lng: 32.622163, kind: "waypoint" },
  { name: "3.DURAK", lat: 39.9907, lng: 32.6395, kind: "stop" },
  { name: "ROTA", lat: 39.985991, lng: 32.645096, kind: "waypoint" },
  { name: "4.DURAK", lat: 39.9807, lng: 32.6488, kind: "stop" },
  { name: "5.DURAK", lat: 39.9396, lng: 32.624, kind: "stop" },
  { name: "6.DURAK", lat: 39.8674, lng: 32.6387, kind: "stop" },
  { name: "7.DURAK", lat: 39.87, lng: 32.6427, kind: "stop" },
  { name: "8.DURAK", lat: 39.7759, lng: 32.6729, kind: "stop" },
  { name: "ELOKTROLAND", lat: 39.7405, lng: 32.8095, kind: "stop" },
];

const DEFAULT_STOPS: Stop[] = SEED.map((s, i) => ({
  ...s,
  id: `seed-${i + 1}`,
  order: i + 1,
}));

export function getStops(): Stop[] {
  if (typeof window === "undefined") return DEFAULT_STOPS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STOPS;
    const parsed = JSON.parse(raw) as Stop[];
    // Eski kayıtlarda kind yoksa varsayılan olarak "stop" kabul et
    return parsed
      .map((s) => ({ ...s, kind: (s.kind ?? "stop") as StopKind }))
      .sort((a, b) => a.order - b.order);
  } catch {
    return DEFAULT_STOPS;
  }
}

export function saveStops(stops: Stop[]) {
  localStorage.setItem(KEY, JSON.stringify(stops));
}

export function addStop(stop: Omit<Stop, "id" | "order" | "kind"> & { kind?: StopKind }): Stop[] {
  const stops = getStops();
  const newStop: Stop = {
    ...stop,
    id: `s${Date.now()}`,
    order: stops.length + 1,
    kind: stop.kind ?? "stop",
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
