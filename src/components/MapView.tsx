import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Stop } from "@/lib/stops";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
const QUALITY_KEY = "acrob.map.quality";

/** Hafif modda çizilmeye devam edecek temel katmanlar. */
const KEEP_BASE_LAYERS = new Set([
  "background",
  "water",
  "waterway",
  "aeroway-taxiway",
  "aeroway-runway-casing",
  "aeroway-runway",
  "road_area_pier",
  "road_pier",
  "highway_path",
  "highway_minor",
  "highway_major_casing",
  "highway_major_inner",
  "highway_major_subtle",
  "highway_motorway_casing",
  "highway_motorway_inner",
  "highway_motorway_subtle",
]);

export interface MapViewProps {
  stops: Stop[];
  selectedStopId?: string | null;
  busPosition?: { lat: number; lng: number } | null;
  routePath?: [number, number][] | null;
  center?: [number, number];
  className?: string;
  onMapClick?: (lat: number, lng: number) => void;
}

function busEl() {
  const el = document.createElement("div");
  el.className = "pulse-marker";
  el.style.cssText =
    "width:38px;height:38px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 6px 10px rgba(0,0,0,0.6));";
  el.innerHTML = `<svg width="38" height="38" viewBox="0 0 24 24" fill="none">
    <ellipse cx="12" cy="20" rx="6" ry="2" fill="rgba(0,0,0,0.35)"/>
    <rect x="6" y="3" width="12" height="17" rx="3.5" fill="#f97316" stroke="#fff" stroke-width="1.4"/>
    <path d="M8 7.5h8v3.5H8z" fill="#dbeafe"/>
    <rect x="8" y="13" width="8" height="4.5" rx="1" fill="#fb923c"/>
  </svg>`;
  return el;
}

function bearingBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Açı farkını en kısa yoldan yumuşat
function smoothBearing(prev: number, next: number, factor = 0.35): number {
  const diff = ((next - prev + 540) % 360) - 180;
  return (prev + diff * factor + 360) % 360;
}

function stopEl(isSelected: boolean, isWaypoint: boolean) {
  const el = document.createElement("div");
  if (isWaypoint) {
    el.style.cssText =
      "width:8px;height:8px;border-radius:50%;background:rgba(239,68,68,0.75);border:1px solid #fff;";
    return el;
  }
  const size = isSelected ? 22 : 16;
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${
    isSelected ? "#ef4444" : "#f7f8fa"
  };border:3px solid #14161c;box-shadow:0 0 8px rgba(0,0,0,0.6);`;
  return el;
}

export default function MapView({
  stops,
  selectedStopId,
  busPosition,
  routePath,
  center = [39.925, 32.85],
  className = "",
  onMapClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, { marker: maplibregl.Marker; key: string }>>(new Map());
  const busMarkerRef = useRef<maplibregl.Marker | null>(null);
  const loadedRef = useRef(false);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const [ready, setReady] = useState(false);
  const [pitch, setPitch] = useState(55);
  const [follow, setFollow] = useState(true);
  // 18. madde: düşük cihazlar için performans anahtarı (3D bina + etiketler)
  const [highQuality, setHighQuality] = useState(false);
  const headingRef = useRef(0);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const headingIdxRef = useRef(0);
  // 15. madde: her fix'te easeTo yerine tek bir rAF döngüsüyle yumuşak kamera
  const camTargetRef = useRef<{ lng: number; lat: number; bearing: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  // 19. madde: harita görünmezken render / kamera döngüsü durur
  const pausedRef = useRef(false);

  const startCamLoop = () => {
    if (rafRef.current != null) return;
    const step = () => {
      rafRef.current = null;
      const map = mapRef.current;
      const t = camTargetRef.current;
      if (!map || !t || !followRef.current || pausedRef.current) return;
      const c = map.getCenter();
      const b = map.getBearing();
      const diff = ((t.bearing - b + 540) % 360) - 180;
      const done =
        Math.abs(t.lng - c.lng) < 1e-6 && Math.abs(t.lat - c.lat) < 1e-6 && Math.abs(diff) < 0.25;
      map.jumpTo(
        done
          ? { center: [t.lng, t.lat], bearing: t.bearing }
          : {
              center: [c.lng + (t.lng - c.lng) * 0.18, c.lat + (t.lat - c.lat) * 0.18],
              bearing: b + diff * 0.14,
            },
      );
      if (!done) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  // Harita kurulum
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const savedQuality =
      typeof window !== "undefined" && window.localStorage.getItem(QUALITY_KEY) === "high";
    if (savedQuality) setHighQuality(true);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [center[1], center[0]],
      zoom: 12,
      pitch: 55,
      bearing: -20,
      maxPitch: 60,
      // Performans: kenar yumuşatma kapalı, tile yeniden çekme yok, fade animasyonu yok
      canvasContextAttributes: { antialias: false, powerPreference: "high-performance" },
      refreshExpiredTiles: false,
      fadeDuration: 0,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      "top-right",
    );
    map.touchZoomRotate.enableRotation();
    // Stil sprite'ında olmayan ikonlar için uyarıları sustur
    map.on("styleimagemissing", (e: { id: string }) => {
      if (map.hasImage(e.id)) return;
      map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    map.on("load", () => {
      loadedRef.current = true;

      // Ara nokta katmanı (DOM işaretçisi yerine GPU)
      map.addSource("acrob-waypoints", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Rota katmanları
      map.addSource("acrob-route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [] },
        },
      });
      map.addLayer({
        id: "acrob-route-casing",
        type: "line",
        source: "acrob-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 12, "line-opacity": 0.55 },
      });
      map.addLayer({
        id: "acrob-route-line",
        type: "line",
        source: "acrob-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#3b82f6", "line-width": 7, "line-opacity": 1 },
      });

      map.addLayer({
        id: "acrob-waypoints-dots",
        type: "circle",
        source: "acrob-waypoints",
        minzoom: 11,
        paint: {
          "circle-radius": 3.5,
          "circle-color": "rgba(239,68,68,0.8)",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#ffffff",
        },
      });

      setReady(true);
    });

    map.on("click", (e: maplibregl.MapMouseEvent) =>
      clickRef.current?.(e.lngLat.lat, e.lngLat.lng),
    );
    // Kullanıcı haritayı elle sürüklerse takibi bırak
    map.on("dragstart", () => setFollow(false));

    // 19. madde: sekme arka plandayken veya harita ekran dışındayken render'ı durdur
    const setPaused = (p: boolean) => {
      if (pausedRef.current === p) return;
      pausedRef.current = p;
      if (p) {
        map.stop();
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      } else {
        map.resize();
        map.triggerRepaint();
        if (followRef.current && camTargetRef.current) startCamLoop();
      }
    };
    const onVis = () => setPaused(document.hidden || !onScreenRef.current);
    const onScreenRef = { current: true };
    const io = new IntersectionObserver(
      (entries) => {
        onScreenRef.current = entries.some((e) => e.isIntersecting);
        setPaused(document.hidden || !onScreenRef.current);
      },
      { threshold: 0.01 },
    );
    io.observe(containerRef.current);
    document.addEventListener("visibilitychange", onVis);

    mapRef.current = map;
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 18. madde: kalite modu — hafif (yalnız yollar/su) ↔ yüksek (etiket + 3D bina)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const layers = map.getStyle().layers ?? [];
    layers.forEach((layer) => {
      if (layer.id.startsWith("acrob-")) return;
      const visible = highQuality || KEEP_BASE_LAYERS.has(layer.id);
      map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    });

    const has3d = !!map.getLayer("acrob-buildings-3d");
    if (highQuality && !has3d) {
      const vectorSource = Object.entries(map.getStyle().sources ?? {}).find(
        ([, s]) => (s as { type?: string }).type === "vector",
      )?.[0];
      if (vectorSource) {
        try {
          map.addLayer(
            {
              id: "acrob-buildings-3d",
              type: "fill-extrusion",
              source: vectorSource,
              "source-layer": "building",
              minzoom: 13.5,
              paint: {
                "fill-extrusion-color": "#2b303c",
                "fill-extrusion-height": [
                  "coalesce",
                  ["get", "render_height"],
                  ["get", "height"],
                  8,
                ],
                "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
                "fill-extrusion-opacity": 0.9,
              },
            } as never,
            map.getLayer("acrob-route-casing") ? "acrob-route-casing" : undefined,
          );
        } catch {
          /* stilde bina katmanı yoksa sessizce geç */
        }
      }
    } else if (!highQuality && has3d) {
      map.removeLayer("acrob-buildings-3d");
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(QUALITY_KEY, highQuality ? "high" : "light");
    }
  }, [highQuality, ready]);

  // İmleç (admin tıklama modu)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = onMapClick ? "crosshair" : "";
  }, [onMapClick, ready]);

  // Rota çizgisi
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("acrob-route") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: (routePath ?? []).map(([lat, lng]) => [lng, lat]),
      },
    });
  }, [routePath, ready]);

  // Duraklar — gerçek duraklar DOM işaretçisi, ara noktalar GPU katmanı (çok daha hafif)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // 16. madde: işaretçiler yeniden oluşturulmaz, mevcut olanlar güncellenir
    const alive = new Set<string>();
    const wp: Array<Record<string, unknown>> = [];
    stops.forEach((s) => {
      if (s.kind === "waypoint") {
        wp.push({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        });
        return;
      }
      alive.add(s.id);
      const key = `${s.lat},${s.lng},${s.order},${s.name},${s.id === selectedStopId ? 1 : 0}`;
      const existing = markersRef.current.get(s.id);
      if (existing) {
        if (existing.key === key) return;
        existing.marker.setLngLat([s.lng, s.lat]);
        existing.marker
          .getPopup()
          ?.setText(`${s.order}. ${s.name}`);
        const el = existing.marker.getElement();
        el.style.cssText = stopEl(s.id === selectedStopId, false).style.cssText;
        markersRef.current.set(s.id, { marker: existing.marker, key });
        return;
      }
      const marker = new maplibregl.Marker({ element: stopEl(s.id === selectedStopId, false) })
        .setLngLat([s.lng, s.lat])
        .addTo(map);
      marker.setPopup(
        new maplibregl.Popup({ offset: 16, closeButton: false }).setText(`${s.order}. ${s.name}`),
      );
      markersRef.current.set(s.id, { marker, key });
    });

    markersRef.current.forEach((entry, id) => {
      if (alive.has(id)) return;
      entry.marker.remove();
      markersRef.current.delete(id);
    });

    const src = map.getSource("acrob-waypoints") as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: wp } as never);
  }, [stops, selectedStopId, ready]);

  // Görünümü yalnızca durak listesi değiştiğinde bir kez sığdır
  const fitKeyRef = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || stops.length === 0) return;
    if (follow && busPosition) return; // takip modunda kamera araçta kalır
    const key = stops.map((s) => `${s.lat},${s.lng}`).join("|");
    if (fitKeyRef.current === key) return;
    fitKeyRef.current = key;
    const bounds = new maplibregl.LngLatBounds();
    stops.forEach((s) => bounds.extend([s.lng, s.lat]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, ready]);

  // Servis konumu + arkadan takip kamerası
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!busPosition) {
      busMarkerRef.current?.remove();
      busMarkerRef.current = null;
      lastPosRef.current = null;
      camTargetRef.current = null;
      return;
    }

    // Yön: önce gerçek hareketten, yoksa rota üzerindeki en yakın segmentten
    const prev = lastPosRef.current;
    let target = headingRef.current;
    if (
      prev &&
      (Math.abs(prev.lat - busPosition.lat) > 1e-6 || Math.abs(prev.lng - busPosition.lng) > 1e-6)
    ) {
      target = bearingBetween(prev, busPosition);
    } else if (routePath && routePath.length > 1) {
      // 17. madde: tüm rotayı taramak yerine son indeksten dar pencere
      const start = Math.max(0, Math.min(headingIdxRef.current, routePath.length - 1));
      const end = Math.min(routePath.length - 1, start + 80);
      let bi = start;
      let bd = Infinity;
      for (let i = start; i <= end; i++) {
        const [la, ln] = routePath[i]!;
        const d = (la - busPosition.lat) ** 2 + (ln - busPosition.lng) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      headingIdxRef.current = bi;
      const nxt = routePath[Math.min(bi + 1, routePath.length - 1)]!;
      const cur = routePath[bi]!;
      if (nxt !== cur) {
        target = bearingBetween({ lat: cur[0], lng: cur[1] }, { lat: nxt[0], lng: nxt[1] });
      }
    }
    headingRef.current = prev ? smoothBearing(headingRef.current, target) : target;
    lastPosRef.current = { lat: busPosition.lat, lng: busPosition.lng };

    if (busMarkerRef.current) {
      busMarkerRef.current.setLngLat([busPosition.lng, busPosition.lat]);
    } else {
      busMarkerRef.current = new maplibregl.Marker({
        element: busEl(),
        rotationAlignment: "map",
        pitchAlignment: "map",
      })
        .setLngLat([busPosition.lng, busPosition.lat])
        .addTo(map);
    }
    busMarkerRef.current.setRotation(headingRef.current);

    if (follow && !pausedRef.current) {
      camTargetRef.current = {
        lng: busPosition.lng,
        lat: busPosition.lat,
        bearing: headingRef.current,
      };
      startCamLoop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busPosition, ready, follow]);

  // Takip açıldığında zoom / eğim / kadraj bir kez ayarlanır (her fix'te değil)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !follow || !busPosition) return;
    map.easeTo({
      center: [busPosition.lng, busPosition.lat],
      bearing: headingRef.current,
      pitch: Math.max(pitch, 45),
      zoom: Math.max(map.getZoom(), 16),
      offset: [0, Math.round(map.getContainer().clientHeight * 0.18)],
      duration: 600,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, ready]);

  const togglePitch = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = pitch > 10 ? 0 : 60;
    setPitch(next);
    map.easeTo({ pitch: next, duration: 600 });
  };

  const resetBearing = () => {
    mapRef.current?.easeTo({ bearing: 0, duration: 600 });
  };

  const toggleFollow = () => {
    const map = mapRef.current;
    const next = !follow;
    setFollow(next);
    if (next && map && busPosition) {
      map.easeTo({
        center: [busPosition.lng, busPosition.lat],
        bearing: headingRef.current,
        pitch: 60,
        zoom: 17,
        offset: [0, map.getContainer().clientHeight * 0.22],
        duration: 800,
      });
    }
  };

  return (
    <div className={`relative w-full h-full ${className}`}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
      <div className="absolute left-3 top-3 z-[400] flex flex-col gap-2">
        <button
          type="button"
          onClick={togglePitch}
          className="rounded-md border border-border bg-card/90 px-3 py-1.5 text-xs font-semibold text-foreground backdrop-blur transition hover:bg-card"
        >
          {pitch > 10 ? "2D Görünüm" : "3D Görünüm"}
        </button>
        <button
          type="button"
          onClick={() => setHighQuality((v) => !v)}
          className={`rounded-md border px-3 py-1.5 text-xs font-semibold backdrop-blur transition ${
            highQuality
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card/90 text-foreground hover:bg-card"
          }`}
        >
          {highQuality ? "🏙 3D Bina Açık" : "Hafif Mod"}
        </button>
        <button
          type="button"
          onClick={resetBearing}
          className="rounded-md border border-border bg-card/90 px-3 py-1.5 text-xs font-semibold text-foreground backdrop-blur transition hover:bg-card"
        >
          Kuzeye Dön
        </button>
        {busPosition && (
          <button
            type="button"
            onClick={toggleFollow}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold backdrop-blur transition ${
              follow
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card/90 text-foreground hover:bg-card"
            }`}
          >
            {follow ? "🎯 Takip Açık" : "Aracı Takip Et"}
          </button>
        )}
      </div>
    </div>
  );
}
