// 14. madde: Geçilen durak / rota temizliği.
// "Tam ulaşınca" mantığı: GPS'te matematiksel 0 metre mümkün değildir (en iyi
// cihazda bile 5-15 m sapma var). Bunun yerine iki aşamalı, çok daha stabil bir
// yöntem kullanılır:
//   1) VARIŞ  : araç durağın hassas yarıçapına (GPS doğruluğuna göre 15-35 m)
//               girer -> durak "ulaşıldı" sayılır.
//   2) GEÇİLDİ: araç o yarıçaptan çıkıp uzaklaşmaya başlar -> durak ve ona ait
//               rota parçası haritadan silinir.
// Böylece 100 m'lik erken silme de, hiç tetiklenmeyen 0 m şartı da yaşanmaz.

import { useEffect, useRef, useState } from "react";
import type { Stop } from "@/lib/stops";

export interface LatLng {
  lat: number;
  lng: number;
}

/** Hassas varış yarıçapı — GPS doğruluğuna göre 15-35 m arası. */
export function arriveRadiusM(accuracyM?: number | null): number {
  const acc = accuracyM != null && isFinite(accuracyM) ? accuracyM : 20;
  return Math.min(35, Math.max(15, acc));
}

/** Varış yarıçapından bu kadar uzaklaşınca "geçildi" kesinleşir. */
export const DEPART_MARGIN_M = 25;

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface PassState {
  /** Yarıçapa girilmiş (tam ulaşılmış) durak id'leri */
  arrived: Set<string>;
  /** Ulaşılıp uzaklaşılmış = geçilmiş durak id'leri */
  passed: Set<string>;
}

export const initialPassState = (): PassState => ({
  arrived: new Set<string>(),
  passed: new Set<string>(),
});

/**
 * Bir durak için mesafeyi işler. Durak yeni "geçildi" olduysa true döner.
 */
export function ingestStopPass(
  state: PassState,
  stopId: string,
  distance: number,
  accuracyM?: number | null,
): boolean {
  if (state.passed.has(stopId)) return false;
  const radius = arriveRadiusM(accuracyM);
  if (distance <= radius) {
    state.arrived.add(stopId);
    return false;
  }
  if (state.arrived.has(stopId) && distance > radius + DEPART_MARGIN_M) {
    state.arrived.delete(stopId);
    state.passed.add(stopId);
    return true;
  }
  return false;
}

/**
 * Rota çizgisinin geçilen kısmını kırpar: araca en yakın rota noktası bulunur,
 * öncesi atılır. Araç rotadan 80 m'den fazla uzaktaysa (yoldan sapma / hatalı
 * fix) kırpma yapılmaz.
 */
export function trimRoutePath(
  path: [number, number][] | null | undefined,
  pos: LatLng | null | undefined,
): [number, number][] | null {
  if (!path || path.length < 2) return path ?? null;
  if (!pos) return path;
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const d = distanceM(pos, { lat: p[0], lng: p[1] });
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestD > 80) return path;
  if (bestIdx <= 0) return path;
  const rest = path.slice(bestIdx);
  return [[pos.lat, pos.lng], ...rest];
}

/**
 * Rota kırpmanın artımlı (incremental) hâli: her tick'te tüm diziyi taramak
 * yerine son bilinen indeksten ileri doğru dar bir pencerede arar.
 * Pencere içinde eşleşme bulunmazsa (sapma / yeni rota) tam taramaya döner.
 */
export function trimRoutePathFrom(
  path: [number, number][] | null | undefined,
  pos: LatLng | null | undefined,
  hintIdx: number,
  window = 80,
): { path: [number, number][] | null; idx: number } {
  if (!path || path.length < 2) return { path: path ?? null, idx: 0 };
  if (!pos) return { path, idx: hintIdx };

  const search = (from: number, to: number) => {
    let bi = from;
    let bd = Infinity;
    for (let i = from; i <= to; i++) {
      const p = path[i]!;
      const d = distanceM(pos, { lat: p[0], lng: p[1] });
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    return { bi, bd };
  };

  const start = Math.max(0, Math.min(hintIdx, path.length - 1));
  let { bi, bd } = search(start, Math.min(path.length - 1, start + window));
  if (bd > 80) {
    const full = search(0, path.length - 1);
    bi = full.bi;
    bd = full.bd;
  }
  if (bd > 80) return { path, idx: hintIdx };
  if (bi <= 0) return { path, idx: 0 };
  return { path: [[pos.lat, pos.lng], ...path.slice(bi)], idx: bi };
}

/**
 * Kırpılmış rotayı throttle'lı üretir (varsayılan 1.2 sn) — haritayı
 * her GPS fix'inde yeniden hesaplamaz.
 */
export function useTrimmedRoutePath(
  path: [number, number][] | null | undefined,
  pos: LatLng | null | undefined,
  throttleMs = 1200,
): [number, number][] | null {
  const idxRef = useRef(0);
  const lastRef = useRef(0);
  const sigRef = useRef("");
  const [out, setOut] = useState<[number, number][] | null>(path ?? null);

  const sig = path ? `${path.length}:${path[0]?.[0]},${path[0]?.[1]}` : "";
  useEffect(() => {
    if (sigRef.current === sig) return;
    sigRef.current = sig;
    idxRef.current = 0;
    lastRef.current = 0;
  }, [sig]);

  useEffect(() => {
    if (!path || path.length < 2) {
      setOut(path ?? null);
      return;
    }
    const now = Date.now();
    if (now - lastRef.current < throttleMs) return;
    lastRef.current = now;
    const res = trimRoutePathFrom(path, pos, idxRef.current);
    idxRef.current = res.idx;
    setOut(res.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, pos?.lat, pos?.lng, throttleMs]);

  return out;
}

/**
 * Duraklar + araç konumundan "geçilmiş" durak kümesini üretir.
 * Şoför ve yolcu panellerinde aynı şekilde kullanılır.
 */
export function usePassedStops(
  stops: Stop[],
  pos: LatLng | null | undefined,
  accuracyM?: number | null,
): Set<string> {
  const stateRef = useRef<PassState>(initialPassState());
  const [passed, setPassed] = useState<Set<string>>(new Set());

  // Durak listesi değişirse (yeni güzergâh) sıfırla
  const sig = stops.map((s) => s.id).join(",");
  useEffect(() => {
    stateRef.current = initialPassState();
    setPassed(new Set());
  }, [sig]);

  useEffect(() => {
    if (!pos) return;
    let changed = false;
    for (const s of stops) {
      if (
        ingestStopPass(
          stateRef.current,
          s.id,
          distanceM(pos, { lat: s.lat, lng: s.lng }),
          accuracyM,
        )
      ) {
        changed = true;
      }
    }
    if (changed) setPassed(new Set(stateRef.current.passed));
  }, [stops, pos?.lat, pos?.lng, accuracyM]);

  return passed;
}
