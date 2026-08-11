import { useEffect, useRef } from "react";
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
}

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_CENTER: [number, number] = [39.925, 32.85];


function stopIcon(selected: boolean) {
  const size = selected ? 22 : 16;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="map-stop-marker${selected ? " is-selected" : ""}"></span>`,
  });
}

function busIcon() {
  return L.divIcon({
    className: "",
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    html: `<span class="map-bus-marker" aria-label="Servis aracı">
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <ellipse cx="12" cy="20" rx="6" ry="2" fill="rgba(0,0,0,0.35)"/>
        <rect x="6" y="3" width="12" height="17" rx="3.5" fill="#f97316" stroke="#fff" stroke-width="1.4"/>
        <path d="M8 7.5h8v3.5H8z" fill="#dbeafe"/>
        <rect x="8" y="13" width="8" height="4.5" rx="1" fill="#fb923c"/>
      </svg>
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
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const busMarkerRef = useRef<L.Marker | null>(null);
  const clickRef = useRef(onMapClick);
  const followRef = useRef(true);
  const hasPositionedRef = useRef(false);
  const centerRef = useRef(center);

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
    map.on("dragstart", () => {
      followRef.current = false;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = stopsLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    stops.forEach((stop) => {
      if (stop.kind === "waypoint") return;
      L.marker([stop.lat, stop.lng], {
        icon: stopIcon(stop.id === selectedStopId),
        keyboard: false,
      })
        .bindPopup(`${stop.order}. ${stop.name}`)
        .addTo(layer);
    });

    if (!busPosition && stops.length > 0 && !hasPositionedRef.current) {
      const bounds = L.latLngBounds(stops.map((stop) => [stop.lat, stop.lng] as L.LatLngTuple));
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [36, 36], maxZoom: 14, animate: false });
        hasPositionedRef.current = true;
      }
    }
  }, [stops, selectedStopId, busPosition]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!busPosition) {
      busMarkerRef.current?.remove();
      busMarkerRef.current = null;
      return;
    }

    const point: L.LatLngTuple = [busPosition.lat, busPosition.lng];
    if (busMarkerRef.current) busMarkerRef.current.setLatLng(point);
    else busMarkerRef.current = L.marker(point, { icon: busIcon(), zIndexOffset: 1000 }).addTo(map);

    if (followRef.current) {
      map.setView(point, Math.max(map.getZoom(), 16), { animate: false });
      hasPositionedRef.current = true;
    }
  }, [busPosition]);

  const followBus = () => {
    const map = mapRef.current;
    if (!map || !busPosition) return;
    followRef.current = true;
    map.setView([busPosition.lat, busPosition.lng], 16, { animate: true });
  };

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {busPosition && (
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
