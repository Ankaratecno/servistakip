import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import Peer, { type DataConnection } from "peerjs";
import { ClientOnly } from "@/components/ClientOnly";
import MapView from "@/components/MapView";
import { DRIVER_PEER_ID, SERVICE_INFO } from "@/lib/service-config";
import { getStops, type Stop } from "@/lib/stops";
import { getRoute, getRouteEta, formatEta, type RouteEtaResult } from "@/lib/routing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Servis Takip – Acrob Elektroland" },
      {
        name: "description",
        content:
          "Servisin durağınıza kaç dakika sonra geleceğini canlı görün. Ankara güzergâhı, gerçek zamanlı konum ve hız takibi.",
      },
      { property: "og:title", content: "Servis Takip – Acrob Elektroland" },
      {
        property: "og:description",
        content:
          "06 FNJ 165 Volkswagen Crafter servisinin canlı konumunu ve durağınıza kalan süreyi görün.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PassengerPage,
});

interface DriverPayload {
  type: "position";
  lat: number;
  lng: number;
  speedKmh: number;
  avgSpeedKmh?: number;
  totalKm?: number;
  heading: number | null;
  plate: string;
  ts: number;
}

function PassengerPage() {
  return (
    <ClientOnly fallback={<LoadingShell />}>
      <PassengerGate />
    </ClientOnly>
  );
}

function LoadingShell() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="hud-label">Yükleniyor...</div>
    </div>
  );
}

function PassengerGate() {
  const [plate, setPlate] = useState<string>(SERVICE_INFO.plate);
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
    if (norm(plate) !== norm(SERVICE_INFO.plate)) {
      setError(`Bu plaka sisteme kayıtlı değil. Beklenen: ${SERVICE_INFO.plate}`);
      return;
    }
    setError(null);
    setEntered(true);
  };

  if (entered) return <PassengerApp onBack={() => setEntered(false)} />;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center p-4">
        <form onSubmit={submit} className="panel p-8 w-full max-w-md">
          <div className="hud-label mb-2">Servis Aracı</div>
          <div className="text-lg font-bold">
            {SERVICE_INFO.vehicle} · {SERVICE_INFO.year}
          </div>
          <div className="text-xs text-muted-foreground mb-6">{SERVICE_INFO.operator}</div>

          <label className="hud-label block mb-2">Plaka</label>
          <input
            type="text"
            value={plate}
            onChange={(e) => setPlate(e.target.value)}
            className="w-full bg-input border border-border rounded-md px-4 py-4 text-2xl font-mono font-bold uppercase text-center tracking-wider focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {error && (
            <div className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-3">
              {error}
            </div>
          )}
          <button
            type="submit"
            className="mt-6 w-full bg-primary text-primary-foreground font-bold py-4 rounded-md hover:bg-primary/90 transition glow-primary text-lg tracking-wide"
          >
            SERVİSİ TAKİP ET
          </button>
          <div className="mt-6 pt-4 border-t border-border flex justify-between text-xs">
            <Link to="/driver" className="text-muted-foreground hover:text-primary">
              → Şoför Girişi
            </Link>
            <Link to="/admin" className="text-muted-foreground hover:text-primary">
              → Durak Yönetimi
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}

function PassengerApp({ onBack }: { onBack: () => void }) {
  const [stops, setStops] = useState<Stop[]>([]);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "offline">("idle");
  const [driver, setDriver] = useState<DriverPayload | null>(null);
  const [eta, setEta] = useState<RouteEtaResult | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loaded = getStops();
    setStops(loaded);
    const firstStop = loaded.find((s) => s.kind === "stop");
    if (firstStop) setSelectedStopId(firstStop.id);
  }, []);

  // Güzergâh çizgisini bir kere çek
  useEffect(() => {
    if (stops.length < 2) return;
    getRoute(stops).then((r) => r && setRoutePath(r.path));
  }, [stops]);

  // PeerJS ile şoföre bağlan
  useEffect(() => {
    if (stops.length === 0) return;
    const peer = new Peer({ debug: 1 });
    peerRef.current = peer;

    const connect = () => {
      setStatus("connecting");
      const conn = peer.connect(DRIVER_PEER_ID, { reliable: true });
      connRef.current = conn;
      conn.on("open", () => setStatus("connected"));
      conn.on("data", (data) => {
        const p = data as DriverPayload;
        if (p?.type === "position") setDriver(p);
      });
      conn.on("close", () => {
        setStatus("offline");
        scheduleReconnect();
      });
      conn.on("error", () => {
        setStatus("offline");
        scheduleReconnect();
      });
    };

    const scheduleReconnect = () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        if (peerRef.current && !peerRef.current.destroyed) connect();
      }, 4000);
    };

    peer.on("open", connect);
    peer.on("error", (err) => {
      // Şoför henüz online değilse peer-unavailable hatası gelir
      if (String(err?.type) === "peer-unavailable") {
        setStatus("offline");
        scheduleReconnect();
      }
    });

    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      connRef.current?.close();
      peer.destroy();
    };
  }, [stops.length]);

  // ETA hesabı - konum ve durak değişince
  const selectedStop = useMemo(
    () => stops.find((s) => s.id === selectedStopId) ?? null,
    [stops, selectedStopId],
  );

  useEffect(() => {
    if (!driver || !selectedStop) {
      setEta(null);
      return;
    }
    let cancelled = false;
    // Güzergâha sadık: aradaki tüm duraklardan geçerek + bekleme süreleriyle
    getRouteEta({ lat: driver.lat, lng: driver.lng }, stops, selectedStop.id).then((r) => {
      if (!cancelled) setEta(r);
    });
    return () => {
      cancelled = true;
    };
  }, [driver?.lat, driver?.lng, selectedStop?.id, stops]);

  const etaText = eta ? formatEta(eta.durationS) : null;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 flex flex-col lg:flex-row gap-4 p-4 max-w-7xl w-full mx-auto">
        {/* Sol panel - durak seçimi & ETA */}
        <div className="lg:w-96 flex flex-col gap-4">
          <button
            onClick={onBack}
            className="panel px-4 py-3 flex items-center gap-2 hover:bg-muted/50 transition text-sm font-semibold uppercase tracking-wider"
          >
            <span>←</span>
            <span>Plaka Ekranına Dön</span>
          </button>
          <StatusBadge status={status} />

          <div className="panel p-5">
            <div className="hud-label mb-3">Durağınız</div>
            <select
              value={selectedStopId ?? ""}
              onChange={(e) => setSelectedStopId(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-3 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {stops
                .filter((s) => s.kind === "stop")
                .map((s, i) => (
                  <option key={s.id} value={s.id}>
                    {i + 1}. {s.name}
                  </option>
                ))}
            </select>
          </div>

          <div className="panel p-6 relative overflow-hidden">
            <div className="hud-label mb-2">Tahmini Varış</div>
            {status !== "connected" ? (
              <div>
                <div className="text-3xl font-bold text-muted-foreground">
                  {status === "offline" || status === "idle"
                    ? "Servis Çevrimdışı"
                    : "Bağlanıyor..."}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Şoför sistemi başlattığında otomatik bağlanılacak.
                </p>
              </div>
            ) : !etaText ? (
              <div className="text-2xl text-muted-foreground">Hesaplanıyor...</div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-bold text-primary font-mono">
                    {etaText.minutes}
                  </span>
                  <span className="text-lg text-muted-foreground">dakika</span>
                  <span className="text-3xl font-bold text-primary font-mono ml-2">
                    {etaText.secs}
                  </span>
                  <span className="text-lg text-muted-foreground">saniye</span>
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  sonra <span className="text-foreground font-semibold">{selectedStop?.name}</span>{" "}
                  durağınızda.
                </p>
                {eta && (
                  <p className="text-xs text-muted-foreground mt-2 font-mono">
                    MESAFE: {(eta.distanceM / 1000).toFixed(2)} KM
                  </p>
                )}
                {eta && eta.viaStops > 0 && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">
                    ÖNCE {eta.viaStops} DURAĞA UĞRAYACAK (+{Math.round(eta.dwellS / 60)} DK BEKLEME)
                  </p>
                )}
              </>
            )}
          </div>

          {driver && status === "connected" && (
            <div className="panel p-5">
              <div className="hud-label mb-3">Canlı Telemetri</div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="hud-label mb-1">Hız</div>
                  <div className="text-3xl font-mono font-bold text-primary">
                    {Math.round(driver.speedKmh)}
                    <span className="text-xs text-muted-foreground ml-1">km/s</span>
                  </div>
                </div>
                <div>
                  <div className="hud-label mb-1">Durum</div>
                  <div className="text-lg font-semibold text-foreground">
                    {driver.speedKmh > 3 ? "Hareket Halinde" : "Duruyor"}
                  </div>
                </div>
              </div>
              {(driver.avgSpeedKmh !== undefined || driver.totalKm !== undefined) && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <div className="hud-label mb-1">Ortalama Hız</div>
                    <div className="text-2xl font-mono font-bold">
                      {Math.round(driver.avgSpeedKmh ?? 0)}
                      <span className="text-xs text-muted-foreground ml-1">km/s</span>
                    </div>
                  </div>
                  <div>
                    <div className="hud-label mb-1">Toplam KM</div>
                    <div className="text-2xl font-mono font-bold">
                      {(driver.totalKm ?? 0).toFixed(1)}
                    </div>
                  </div>
                </div>
              )}
              <div className="hud-label mt-4">Araç</div>
              <div className="text-sm text-foreground mt-1">
                {SERVICE_INFO.vehicle} · {SERVICE_INFO.year}
              </div>
              <div className="text-xs font-mono text-primary mt-1">{driver.plate}</div>
            </div>
          )}
        </div>

        {/* Harita */}
        <div className="flex-1 panel overflow-hidden min-h-[400px] lg:min-h-[600px]">
          <MapView
            stops={stops}
            selectedStopId={selectedStopId}
            busPosition={driver ? { lat: driver.lat, lng: driver.lng } : null}
            routePath={routePath}
            className="h-full min-h-[400px] lg:min-h-[600px]"
          />
        </div>
      </main>

      <footer className="text-center text-xs text-muted-foreground py-4 border-t border-border">
        <Link to="/driver" className="hover:text-primary mx-2">
          Şoför Girişi
        </Link>
        ·
        <Link to="/admin" className="hover:text-primary mx-2">
          Durak Yönetimi
        </Link>
      </footer>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-lg glow-primary">
          🚐
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold leading-tight">ACROB ELEKTROLAND</h1>
          <p className="text-xs text-muted-foreground font-mono tracking-wider">
            İNSAFSIZ KARA ARACI · SERVİS TAKİP
          </p>
        </div>
      </div>
    </header>
  );
}

function StatusBadge({ status }: { status: "idle" | "connecting" | "connected" | "offline" }) {
  const map = {
    idle: { text: "Bekliyor", color: "bg-muted", dot: "bg-muted-foreground" },
    connecting: { text: "Bağlanıyor", color: "bg-secondary", dot: "bg-yellow-500 animate-pulse" },
    connected: { text: "Canlı", color: "bg-primary/20", dot: "bg-primary animate-pulse" },
    offline: { text: "Servis Çevrimdışı", color: "bg-muted", dot: "bg-red-500" },
  }[status];
  return (
    <div className={`panel px-4 py-3 flex items-center gap-3 ${map.color}`}>
      <div className={`w-2.5 h-2.5 rounded-full ${map.dot}`} />
      <span className="text-sm font-semibold uppercase tracking-wider">{map.text}</span>
    </div>
  );
}
