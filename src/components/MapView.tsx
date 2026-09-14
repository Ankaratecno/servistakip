import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Stop } from "@/lib/stops";

export interface MapViewProps {
  stops: Stop[];
  selectedStopId?: string | null;
  busPosition?: { lat: number; lng: number } | null;
  routePath?: [number, number][] | null;
  center?: [number, number];
  className?: string;
  onMapClick?: (lat: number, lng: number) => void;
  /** YAPILACAKLAR3 #58: araç rozeti — yön oku (derece) */
  busHeading?: number | null;
  /** #58: araç rozeti — hız etiketi (km/s) */
  busSpeedKmh?: number | null;
  /** #58: durak pinlerinde "kalan süre" balonu (durak id → "4 dk") */
  stopEta?: Record<string, string>;
  /** Verilirse varsayılan SVG yerine bu araç görseli kullanılır ve yöne göre döner. */
  busIconUrl?: string | null;
}

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_CENTER: [number, number] = [39.925, 32.85];

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function stopIcon(selected: boolean) {
  const size = selected ? 22 : 16;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="map-stop-marker${selected ? " is-selected" : ""}"></span>`,
  });
}

/** #58: yön oku + hız etiketi taşıyan servis rozeti. */
function busIcon(heading?: number | null, speedKmh?: number | null, iconUrl?: string | null) {
  const deg = Number.isFinite(heading as number) ? (heading as number) : null;
  const kmh = Number.isFinite(speedKmh as number) ? Math.round(speedKmh as number) : null;
  const label = kmh === null ? "" : `<span class="map-bus-speed">${kmh} km/s</span>`;

  // Araç görseli modu: görsel önü aşağı (güney) bakar; kuzey=0° için +180° döndür.
  // Durum halkası: hareket halinde (>= 3 km/s) yeşil, dururken kırmızı yanıp söner.
  if (iconUrl) {
    const rot = deg === null ? "" : ` style="transform: rotate(${deg + 180}deg)"`;
    const moving = kmh !== null && kmh >= 3;
    const ring = `<span class="map-bus-ring ${moving ? "is-moving" : "is-stopped"}" aria-hidden="true"></span>`;
    return L.divIcon({
      className: "",
      iconSize: [64, 64],
      iconAnchor: [32, 32],
      html: `<span class="map-bus-badge" aria-label="Servis aracı">
        ${ring}
        <span class="map-bus-vehicle"${rot}>
          <img src="${escapeHtml(iconUrl)}" width="48" height="48" alt="" />
        </span>
        ${label}
      </span>`,
    });
  }

  const arrow =
    deg === null
      ? ""
      : `<span class="map-bus-arrow" style="transform: rotate(${deg}deg)">
          <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
            <path d="M27 1 L33 14 L27 11 L21 14 Z" fill="#38bdf8" stroke="#0b0f14" stroke-width="1"/>
          </svg>
        </span>`;
  return L.divIcon({
    className: "",
    iconSize: [54, 54],
    iconAnchor: [27, 27],
    html: `<span class="map-bus-badge" aria-label="Servis aracı">
      ${arrow}
      <span class="map-bus-marker">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <ellipse cx="12" cy="20" rx="6" ry="2" fill="rgba(0,0,0,0.35)"/>
          <rect x="6" y="3" width="12" height="17" rx="3.5" fill="#f97316" stroke="#fff" stroke-width="1.4"/>
          <path d="M8 7.5h8v3.5H8z" fill="#dbeafe"/>
          <rect x="8" y="13" width="8" height="4.5" rx="1" fill="#fb923c"/>
        </svg>
      </span>
      ${label}
    </span>`,
  });
}

export default function MapView({
  stops,
  selectedStopId,
  busPosition,
  routePath,
  center = DEFAULT_CENTER,
  className = "",
  onMapClick,
  busHeading = null,
  busSpeedKmh = null,
  stopEta,
  busIconUrl = null,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const busMarkerRef = useRef<L.Marker | null>(null);
  const clickRef = useRef(onMapClick);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  /** Kendi setView/panTo çağrılarımızı kullanıcı hareketinden ayırmak için. */
  const selfMoveRef = useRef(false);
  const hasPositionedRef = useRef(false);
  const centerRef = useRef(center);

  const stopFollow = () => {
    if (!followRef.current) return;
    followRef.current = false;
    setFollowing(false);
  };

  clickRef.current = onMapClick;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = L.map(container, {
      center: centerRef.current,
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    });

    L.tileLayer(TILE_URL, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
      crossOrigin: true,
      updateWhenIdle: false,
      keepBuffer: 3,
    }).addTo(map);

    stopsLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    map.on("click", (event: L.LeafletMouseEvent) => {
      clickRef.current?.(event.latlng.lat, event.latlng.lng);
    });
    map.on("dragstart", stopFollow);
    // Kullanıcı kendi zoom yaptığında (tekerlek, +/- düğmesi, çift tık, pinch)
    // takip modu bırakılır; böylece harita tekrar araca zorla yakınlaşmaz.
    map.on("zoomstart", () => {
      if (selfMoveRef.current) return;
      stopFollow();
    });

    mapRef.current = map;
    const resize = () => map.invalidateSize({ animate: false });
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    requestAnimationFrame(resize);
    window.setTimeout(resize, 250);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      stopsLayerRef.current = null;
      routeLayerRef.current = null;
      busMarkerRef.current = null;
      hasPositionedRef.current = false;
    };
  }, []);

  const stopEtaRef = useRef(stopEta);
  stopEtaRef.current = stopEta;
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const busPositionRef = useRef(busPosition);
  busPositionRef.current = busPosition;

  // Pinler yalnızca durak listesi / seçim değişince yeniden çizilir.
  useEffect(() => {
    const map = mapRef.current;
    const layer = stopsLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    markersRef.current.clear();
    stops.forEach((stop) => {
      if (stop.kind === "waypoint") return;
      const marker = L.marker([stop.lat, stop.lng], {
        icon: stopIcon(stop.id === selectedStopId),
        keyboard: false,
      })
        .bindPopup(`${stop.order}. ${stop.name}`)
        .addTo(layer);
      markersRef.current.set(stop.id, marker);
      const eta = stopEtaRef.current?.[stop.id];
      if (eta) {
        marker.bindTooltip(escapeHtml(eta), {
          permanent: true,
          direction: "top",
          offset: [0, -10],
          className: `map-eta-bubble${stop.id === selectedStopId ? " is-selected" : ""}`,
        });
      }
    });

    if (!busPositionRef.current && stops.length > 0 && !hasPositionedRef.current) {
      const bounds = L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as L.LatLngTuple));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14, animate: false });
        hasPositionedRef.current = true;
      }
    }
  }, [stops, selectedStopId]);

  // #58: kalan süre balonları pinleri yeniden çizmeden güncellenir.
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const eta = stopEta?.[id];
      const tooltip = marker.getTooltip();
      if (!eta) {
        if (tooltip) marker.unbindTooltip();
        return;
      }
      if (tooltip) marker.setTooltipContent(escapeHtml(eta));
      else
        marker.bindTooltip(escapeHtml(eta), {
          permanent: true,
          direction: "top",
          offset: [0, -10],
          className: `map-eta-bubble${id === selectedStopId ? " is-selected" : ""}`,
        });
    });
  }, [stopEta, selectedStopId]);

  useEffect(() => {
    const layer = routeLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!routePath || routePath.length < 2) return;

    const points = routePath.map(([lat, lng]) => [lat, lng] as L.LatLngTuple);
    L.polyline(points, {
      color: "#ffffff",
      weight: 10,
      opacity: 0.55,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(layer);
    L.polyline(points, {
      color: "#3b82f6",
      weight: 6,
      opacity: 1,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(layer);
  }, [routePath]);

  const busIconKeyRef = useRef<string>("");

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!busPosition) {
      busMarkerRef.current?.remove();
      busMarkerRef.current = null;
      busIconKeyRef.current = "";
      return;
    }

    const point: L.LatLngTuple = [busPosition.lat, busPosition.lng];
    // #58: ikon yalnızca yön/hız gözle görülür değişince yeniden üretilir (kasma önlenir)
    const deg = Number.isFinite(busHeading as number)
      ? Math.round((busHeading as number) / 5) * 5
      : "";
    const kmh = Number.isFinite(busSpeedKmh as number) ? Math.round(busSpeedKmh as number) : "";
    const key = `${deg}|${kmh}`;

    if (!busMarkerRef.current) {
      busMarkerRef.current = L.marker(point, {
        icon: busIcon(busHeading, busSpeedKmh, busIconUrl),
        zIndexOffset: 1000,
      }).addTo(map);
      busIconKeyRef.current = key;
    } else {
      busMarkerRef.current.setLatLng(point);
      if (busIconKeyRef.current !== key) {
        busMarkerRef.current.setIcon(busIcon(busHeading, busSpeedKmh, busIconUrl));
        busIconKeyRef.current = key;
      }
    }

    if (followRef.current) {
      selfMoveRef.current = true;
      if (!hasPositionedRef.current) {
        // İlk konumda bir kez yakınlaş; sonrasında kullanıcının zoom'una dokunma.
        map.setView(point, Math.max(map.getZoom(), 16), { animate: false });
        hasPositionedRef.current = true;
      } else {
        map.panTo(point, { animate: false });
      }
      window.setTimeout(() => {
        selfMoveRef.current = false;
      }, 0);
    }
  }, [busPosition, busHeading, busSpeedKmh, busIconUrl]);

  const followBus = () => {
    const map = mapRef.current;
    if (!map || !busPosition) return;
    followRef.current = true;
    setFollowing(true);
    selfMoveRef.current = true;
    map.setView([busPosition.lat, busPosition.lng], Math.max(map.getZoom(), 15), { animate: true });
    window.setTimeout(() => {
      selfMoveRef.current = false;
    }, 400);
  };

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {busPosition && !following && (
        <button
          type="button"
          onClick={followBus}
          className="absolute left-3 top-3 z-[500] rounded-md border border-border bg-card/95 px-3 py-2 text-xs font-semibold text-foreground shadow-md transition hover:bg-card"
        >
          Aracı Takip Et
        </button>
      )}
    </div>
  );
}
