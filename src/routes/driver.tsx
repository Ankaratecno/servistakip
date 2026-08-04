import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import Peer, { type DataConnection } from "peerjs";
import { ClientOnly } from "@/components/ClientOnly";
import MapView from "@/components/MapView";
import { DRIVER_PEER_ID, SERVICE_INFO } from "@/lib/service-config";
import { getStops, type Stop } from "@/lib/stops";
import { getRoute, haversineM } from "@/lib/routing";
import {
  avgSpeedKmh,
  loadStats,
  resetStats,
  saveStats,
  EMPTY_STATS,
  type TripStats,
} from "@/lib/trip-stats";

export const Route = createFileRoute("/driver")({
  head: () => ({
    meta: [
      { title: "Şoför Paneli – Acrob Elektroland" },
      {
        name: "description",
        content: "Servis şoförü kontrol paneli. Plaka doğrulaması ile konum yayınını başlatın.",
      },
      { property: "og:title", content: "Şoför Paneli – Acrob Elektroland" },
      {
        property: "og:description",
        content: "06 FNJ 165 servis aracı için konum yayını ve şoför kontrol paneli.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ClientOnly
      fallback={
        <div className="min-h-screen flex items-center justify-center text-muted-foreground">
          Yükleniyor...
        </div>
      }
    >
      <DriverApp />
    </ClientOnly>
  ),
});

function DriverApp() {
  const [plate] = useState(SERVICE_INFO.plate);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [peerReady, setPeerReady] = useState(false);
  const [connCount, setConnCount] = useState(0);
  const [stops] = useState<Stop[]>(() => getStops());
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const [stats, setStats] = useState<TripStats>(EMPTY_STATS);
  const statsRef = useRef<TripStats>(EMPTY_STATS);
  const lastFixRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Set<DataConnection>>(new Set());
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (stops.length >= 2) getRoute(stops).then((r) => r && setRoutePath(r.path));
  }, [stops]);

  // Kalıcı istatistikleri IndexedDB'den yükle
  useEffect(() => {
    loadStats().then((s) => {
      statsRef.current = s;
      setStats(s);
    });
  }, []);

  const start = () => {
    setError(null);
    // Plaka doğrulama (boşluk ve büyük/küçük harf toleranslı)
    const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
    if (norm(plate) !== norm(SERVICE_INFO.plate)) {
      setError(`Bu plaka sisteme kayıtlı değil. Beklenen: ${SERVICE_INFO.plate}`);
      return;
    }
    if (!("geolocation" in navigator)) {
      setError("Tarayıcınız konum servisini desteklemiyor.");
      return;
    }

    const peer = new Peer(DRIVER_PEER_ID, { debug: 1 });
    peerRef.current = peer;

    peer.on("open", () => {
      setPeerReady(true);
      setRunning(true);
    });

    peer.on("connection", (conn) => {
      connectionsRef.current.add(conn);
      setConnCount(connectionsRef.current.size);
      conn.on("open", () => {
        // Son bilinen konumu hemen gönder
        const p = watchLastRef.current;
        if (p) conn.send(p);
      });
      conn.on("close", () => {
        connectionsRef.current.delete(conn);
        setConnCount(connectionsRef.current.size);
      });
      conn.on("error", () => {
        connectionsRef.current.delete(conn);
        setConnCount(connectionsRef.current.size);
      });
    });

    peer.on("error", (err) => {
      if (String(err?.type) === "unavailable-id") {
        setError("Bu servis şu an başka bir cihazdan yayınlanıyor. Diğer oturumu kapatın.");
      } else {
        setError(`Bağlantı hatası: ${err.message}`);
      }
      stopInternal();
    });

    // Konum takibi
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition(pos);
        // --- Kalıcı sürüş istatistikleri (IndexedDB) ---
        const now = pos.timestamp || Date.now();
        const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: now };
        const prev = lastFixRef.current;
        const gpsSpeed = pos.coords.speed ? Math.max(0, pos.coords.speed * 3.6) : 0;
        if (prev) {
          const dt = (now - prev.ts) / 1000;
          const dm = haversineM(prev, cur);
          // GPS zıplamalarını ve duruştaki gürültüyü ele
          if (dt > 0.5 && dt < 120 && dm > 3 && dm / dt < 60) {
            const s = statsRef.current;
            const segSpeed = (dm / dt) * 3.6;
            const next: TripStats = {
              totalMeters: s.totalMeters + dm,
              movingSeconds: s.movingSeconds + dt,
              maxSpeedKmh: Math.max(s.maxSpeedKmh, gpsSpeed || segSpeed),
              startedAt: s.startedAt || now,
              updatedAt: now,
            };
            statsRef.current = next;
            setStats(next);
            void saveStats(next);
          }
        }
        lastFixRef.current = cur;

        const payload = {
          type: "position" as const,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speedKmh: gpsSpeed,
          avgSpeedKmh: avgSpeedKmh(statsRef.current),
          totalKm: statsRef.current.totalMeters / 1000,
          heading: pos.coords.heading,
          plate: SERVICE_INFO.plate,
          ts: Date.now(),
        };
        watchLastRef.current = payload;
        connectionsRef.current.forEach((c) => {
          try {
            if (c.open) c.send(payload);
          } catch {
            /* ignore */
          }
        });
      },
      (err) => setError(`Konum alınamadı: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  };

  const watchLastRef = useRef<{
    type: "position";
    lat: number;
    lng: number;
    speedKmh: number;
    avgSpeedKmh: number;
    totalKm: number;
    heading: number | null;
    plate: string;
    ts: number;
  } | null>(null);

  const stopInternal = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    connectionsRef.current.forEach((c) => c.close());
    connectionsRef.current.clear();
    peerRef.current?.destroy();
    peerRef.current = null;
    setConnCount(0);
    setPeerReady(false);
    setRunning(false);
    setPosition(null);
    lastFixRef.current = null;
  };

  useEffect(() => () => stopInternal(), []);

  const speedKmh = position?.coords.speed ? Math.max(0, position.coords.speed * 3.6) : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/" className="hud-label hover:text-primary">
            ← Ana Sayfa
          </Link>
          <div className="flex-1 text-center">
            <h1 className="text-lg font-bold">ŞOFÖR PANELİ</h1>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 flex flex-col gap-4">
        {!running ? (
          <div className="panel p-8 max-w-md mx-auto w-full">
            <div className="hud-label mb-2">Servis Bilgisi</div>
            <div className="text-lg font-bold mb-1">
              {SERVICE_INFO.vehicle} {SERVICE_INFO.year}
            </div>
            <div className="text-xs text-muted-foreground mb-6">{SERVICE_INFO.operator}</div>

            <label className="hud-label block mb-2">Plaka (sabit)</label>
            <input
              type="text"
              value={plate}
              readOnly
              aria-readonly="true"
              className="w-full bg-input border border-border rounded-md px-4 py-4 text-xl font-mono font-bold uppercase text-primary cursor-not-allowed focus:outline-none"
            />
            {error && (
              <div className="mt-3 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-3">
                {error}
              </div>
            )}
            <button
              onClick={start}
              className="mt-6 w-full bg-primary text-primary-foreground font-bold py-4 rounded-md hover:bg-primary/90 transition glow-primary text-lg tracking-wide"
            >
              YAYINI BAŞLAT
            </button>
            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              "Başlat"a bastığınızda tarayıcı konum izni isteyecek. İzin verdikten sonra yolcular
              konumunuzu ve durağa kalan süreyi görebilecek. Bu sekmeyi <strong>açık tutun</strong>.
            </p>
          </div>
        ) : (
          <>
            <div className="panel p-5 flex items-center gap-4">
              <div className="w-3 h-3 rounded-full bg-primary animate-pulse" />
              <div className="flex-1">
                <div className="hud-label">Durum</div>
                <div className="font-bold">YAYINDA · {SERVICE_INFO.plate}</div>
              </div>
              <div className="text-right">
                <div className="hud-label">Yolcu</div>
                <div className="text-2xl font-mono font-bold text-primary">{connCount}</div>
              </div>
              <button
                onClick={stopInternal}
                className="bg-destructive text-destructive-foreground px-4 py-2 rounded-md font-semibold hover:bg-destructive/90"
              >
                Durdur
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="panel p-5">
                <div className="hud-label mb-2">Hız</div>
                <div className="text-5xl font-mono font-bold text-primary">
                  {Math.round(speedKmh)}
                  <span className="text-sm text-muted-foreground ml-2">km/s</span>
                </div>
              </div>
              <div className="panel p-5">
                <div className="hud-label mb-2">GPS Doğruluk</div>
                <div className="text-3xl font-mono font-bold">
                  {position ? `±${Math.round(position.coords.accuracy)}m` : "—"}
                </div>
              </div>
            </div>

            <div className="panel p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="hud-label">Kalıcı Sürüş Sayacı (cihazda saklanır)</div>
                <button
                  onClick={async () => {
                    const fresh = await resetStats();
                    statsRef.current = fresh;
                    setStats(fresh);
                    lastFixRef.current = null;
                  }}
                  className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50"
                >
                  Sıfırla
                </button>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="hud-label mb-1">Toplam KM</div>
                  <div className="text-3xl font-mono font-bold text-primary">
                    {(stats.totalMeters / 1000).toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="hud-label mb-1">Ortalama Hız</div>
                  <div className="text-3xl font-mono font-bold">
                    {Math.round(avgSpeedKmh(stats))}
                    <span className="text-xs text-muted-foreground ml-1">km/s</span>
                  </div>
                </div>
                <div>
                  <div className="hud-label mb-1">En Yüksek Hız</div>
                  <div className="text-3xl font-mono font-bold">
                    {Math.round(stats.maxSpeedKmh)}
                    <span className="text-xs text-muted-foreground ml-1">km/s</span>
                  </div>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-3 font-mono">
                HAREKET SÜRESİ: {Math.floor(stats.movingSeconds / 60)} dk
              </div>
            </div>

            <div className="panel overflow-hidden flex-1 min-h-[400px]">
              <MapView
                stops={stops}
                busPosition={
                  position
                    ? { lat: position.coords.latitude, lng: position.coords.longitude }
                    : null
                }
                routePath={routePath}
                className="h-full min-h-[400px]"
              />
            </div>

            {!peerReady && (
              <div className="text-center text-sm text-muted-foreground">
                PeerJS sunucusuna bağlanılıyor...
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
