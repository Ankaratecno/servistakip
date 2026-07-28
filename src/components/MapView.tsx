import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Stop } from "@/lib/stops";

// Leaflet default icon fix (bundler'da resim yolu bozuluyor)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const busIcon = L.divIcon({
  className: "bus-icon",
  html: `<div style="width:36px;height:36px;border-radius:50%;background:oklch(0.62 0.22 25);border:3px solid white;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 0 20px oklch(0.62 0.22 25 / 0.8);" class="pulse-marker">🚐</div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const stopIcon = (isSelected: boolean) =>
  L.divIcon({
    className: "stop-icon",
    html: `<div style="width:${isSelected ? 22 : 16}px;height:${isSelected ? 22 : 16}px;border-radius:50%;background:${isSelected ? "oklch(0.62 0.22 25)" : "oklch(0.98 0.005 240)"};border:3px solid oklch(0.16 0.01 260);box-shadow:0 0 8px rgba(0,0,0,0.6);"></div>`,
    iconSize: [isSelected ? 22 : 16, isSelected ? 22 : 16],
    iconAnchor: [isSelected ? 11 : 8, isSelected ? 11 : 8],
  });

const waypointIcon = L.divIcon({
  className: "waypoint-icon",
  html: `<div style="width:8px;height:8px;border-radius:50%;background:oklch(0.62 0.22 25 / 0.7);border:1px solid white;"></div>`,
  iconSize: [8, 8],
  iconAnchor: [4, 4],
});

export interface MapViewProps {
  stops: Stop[];
  selectedStopId?: string | null;
  busPosition?: { lat: number; lng: number } | null;
  routePath?: [number, number][] | null;
  center?: [number, number];
  className?: string;
  onMapClick?: (lat: number, lng: number) => void;
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
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const busMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center,
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    layersRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Tıklama handler (admin için)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!onMapClick) return;
    const handler = (e: L.LeafletMouseEvent) => onMapClick(e.latlng.lat, e.latlng.lng);
    map.on("click", handler);
    const el = map.getContainer();
    el.style.cursor = "crosshair";
    return () => {
      map.off("click", handler);
      el.style.cursor = "";
    };
  }, [onMapClick]);

  // Duraklar ve rota
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers) return;
    layers.clearLayers();

    if (routePath && routePath.length > 1) {
      L.polyline(routePath, {
        className: "service-road-route-casing",
        color: "var(--route-line-casing)",
        weight: 12,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layers);

      L.polyline(routePath, {
        className: "service-road-route",
        color: "var(--route-line)",
        weight: 7,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(layers);
    }

    stops.forEach((s) => {
      const isWaypoint = s.kind === "waypoint";
      L.marker([s.lat, s.lng], {
        icon: isWaypoint ? waypointIcon : stopIcon(s.id === selectedStopId),
        interactive: !isWaypoint,
        keyboard: !isWaypoint,
      })
        .addTo(layers)
        .bindTooltip(
          isWaypoint ? `Rota noktası #${s.order}` : `${s.order}. ${s.name}`,
          { permanent: false, direction: "top" },
        );
    });

    if (stops.length > 0) {
      const bounds = L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number]));
      if (busPosition) bounds.extend([busPosition.lat, busPosition.lng]);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [stops, selectedStopId, routePath, busPosition]);

  // Servis konumu
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!busPosition) {
      if (busMarkerRef.current) {
        busMarkerRef.current.remove();
        busMarkerRef.current = null;
      }
      return;
    }
    if (busMarkerRef.current) {
      busMarkerRef.current.setLatLng([busPosition.lat, busPosition.lng]);
    } else {
      busMarkerRef.current = L.marker([busPosition.lat, busPosition.lng], {
        icon: busIcon,
        zIndexOffset: 1000,
      }).addTo(map);
    }
  }, [busPosition]);

  return <div ref={containerRef} className={`w-full h-full ${className}`} />;
}
