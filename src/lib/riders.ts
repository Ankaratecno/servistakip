// Yolcu varlık bildirimi: hangi yolcu hangi duraktan takip ediyor.
// Şoför panelindeki "SERVİSTE" listesi bu paketlerle beslenir.

export interface PresencePayload {
  type: "presence";
  stopId: string | null;
  stopName: string | null;
  ts: number;
}

export interface Rider {
  peerId: string;
  stopId: string | null;
  stopName: string | null;
  ts: number;
}

export interface RiderGroup {
  stopId: string;
  stopName: string;
  count: number;
}

/** Durak sırasına göre gruplanmış takipçi listesi. */
export function groupRiders(riders: Rider[], order: string[]): RiderGroup[] {
  const map = new Map<string, RiderGroup>();
  for (const r of riders) {
    const key = r.stopId ?? "?";
    const name = r.stopName ?? "DURAK SEÇİLMEDİ";
    const g = map.get(key);
    if (g) g.count += 1;
    else map.set(key, { stopId: key, stopName: name, count: 1 });
  }
  const idx = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? 9999 : i;
  };
  return Array.from(map.values()).sort((a, b) => idx(a.stopId) - idx(b.stopId));
}
