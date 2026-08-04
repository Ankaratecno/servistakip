import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Peer, { type DataConnection } from "peerjs";
import { ClientOnly } from "@/components/ClientOnly";
import { DRIVER_PEER_ID, SERVICE_INFO } from "@/lib/service-config";
import { driverGateStatus, unlockDriver } from "@/lib/driver-gate.functions";
import { getStops, type Stop } from "@/lib/stops";
import { getRoute } from "@/lib/routing";
import {
  avgSpeedKmh,
  loadStats,
  resetStats,
  saveStats,
  EMPTY_STATS,
  ingestFix,
  initialFilterState,
  type FilterState,
  type TripStats,
} from "@/lib/trip-stats";

const MapView = lazy(() => import("@/components/MapView"));

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
      <DriverGate />
    </ClientOnly>
  ),
});

function DriverGate() {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    driverGateStatus()
      .then((r) => setUnlocked(r.unlocked))
      .catch(() => setUnlocked(false));
  }, []);

  if (unlocked === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Kontrol ediliyor...
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              const res = await unlockDriver({ data: { password: pw } });
              if (res.ok) setUnlocked(true);
              else setErr("Şifre hatalı.");
            } catch {
              setErr("Doğrulama yapılamadı, tekrar deneyin.");
            } finally {
              setBusy(false);
            }
          }}
          className="panel p-8 w-full max-w-sm"
        >
          <div className="hud-label mb-2">Şoför Girişi</div>
          <h1 className="text-lg font-bold mb-6">{SERVICE_INFO.driverName}</h1>
          <label className="hud-label block mb-2" htmlFor="driver-pw">
            Şifre
          </label>
          <input
            id="driver-pw"
            name="password"
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="w-full bg-input border border-border rounded-md px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {err && <div className="mt-3 text-sm text-red-400">{err}</div>}
          <button
            type="submit"
            disabled={busy}
            className="mt-6 w-full bg-primary text-primary-foreground font-bold py-3 rounded-md hover:bg-primary/90 transition disabled:opacity-60"
          >
            {busy ? "Kontrol ediliyor..." : "GİRİŞ"}
          </button>
          <Link to="/" className="hud-label block mt-4 text-center hover:text-primary">
            ← Ana Sayfa
          </Link>
        </form>
      </div>
    );
  }

  return <DriverApp />;
}

function DriverApp() {
  const [plate] = useState(SERVICE_INFO.plate);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [peerReady, setPeerReady] = useState(false);
  const [connCount, setConnCount] = useState(0);
  const [allStops] = useState<Stop[]>(() => getStops());
  const [startStopId, setStartStopId] = useState<string>("");
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const [stats, setStats] = useState<TripStats>(EMPTY_STATS);
  const [liveSpeed, setLiveSpeed] = useState(0);
  const statsRef = useRef<TripStats>(EMPTY_STATS);
  const filterRef = useRef<FilterState>(initialFilterState());
  const lastSaveRef = useRef<number>(0);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Set<DataConnection>>(new Set());
  const watchIdRef = useRef<number | null>(null);

  // Rota noktaları dahil tüm liste (şoför her noktayı başlangıç seçebilir / atlayabilir)
  const realStops = allStops;

  // İlk açılışta başlangıç = listedeki ilk nokta
  useEffect(() => {
    if (!startStopId && allStops.length > 0) setStartStopId(allStops[0]!.id);
  }, [allStops, startStopId]);

  // Şoförün bugün için seçtiği aktif güzergâh (atlanan durak/rota noktaları çıkarılmış)
  const stops = useMemo<Stop[]>(() => {
    const startIdx = allStops.findIndex((s) => s.id === startStopId);
    const from = startIdx >= 0 ? allStops.slice(startIdx) : allStops;
    const kept = from.filter((s) => !skipped.has(s.id));
    return kept.map((s, i) => ({ ...s, order: i + 1 }));
  }, [allStops, startStopId, skipped]);


  const stopsRef = useRef<Stop[]>(stops);
  stopsRef.current = stops;

  const routePayload = () => ({ type: "route" as const, stops: stopsRef.current, ts: Date.now() });

  const broadcastRoute = () => {
    const payload = routePayload();
    connectionsRef.current.forEach((c) => {
      try {
        if (c.open) c.send(payload);
      } catch {
        /* ignore */
      }
    });
  };

  useEffect(() => {
    if (stops.length >= 2) getRoute(stops).then((r) => r && setRoutePath(r.path));
    if (running) broadcastRoute();
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
        // Aktif güzergâhı ve son bilinen konumu hemen gönder
        try {
          conn.send(routePayload());
        } catch {
          /* ignore */
        }
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
        // --- Filtrelenmiş, kalıcı sürüş istatistikleri (IndexedDB) ---
        const now = pos.timestamp || Date.now();
        const gpsSpeed = pos.coords.speed != null ? Math.max(0, pos.coords.speed * 3.6) : null;
        const res = ingestFix(statsRef.current, filterRef.current, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: now,
          accuracy: pos.coords.accuracy,
          gpsSpeedKmh: gpsSpeed,
        });
        setLiveSpeed(res.speedKmh);
        if (res.accepted) {
          statsRef.current = res.stats;
          setStats(res.stats);
          // Yazmayı seyrekleştir (IndexedDB'yi yormamak için ~5 sn)
          if (now - lastSaveRef.current > 5000) {
            lastSaveRef.current = now;
            void saveStats(res.stats);
          }
        }

        const payload = {
          type: "position" as const,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speedKmh: res.speedKmh,
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
    filterRef.current = initialFilterState();
    setLiveSpeed(0);
  };

  useEffect(() => () => stopInternal(), []);

  const speedKmh = liveSpeed;

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
          <div className="panel p-8 max-w-xl mx-auto w-full">
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

            <div className="mt-6">
              <StopPlanner
                realStops={realStops}
                startStopId={startStopId}
                setStartStopId={setStartStopId}
                skipped={skipped}
                setSkipped={setSkipped}
              />
            </div>

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

            <div className="panel p-5">
              <StopPlanner
                realStops={realStops}
                startStopId={startStopId}
                setStartStopId={setStartStopId}
                skipped={skipped}
                setSkipped={setSkipped}
              />
              <p className="text-xs text-muted-foreground mt-3">
                Buradaki değişiklikler anında tüm yolculara gönderilir; süre ve harita güncellenir.
              </p>
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
                    filterRef.current = initialFilterState();
                    setLiveSpeed(0);
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
              <Suspense fallback={null}>
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
              </Suspense>
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

function StopPlanner({
  realStops,
  startStopId,
  setStartStopId,
  skipped,
  setSkipped,
}: {
  realStops: Stop[];
  startStopId: string;
  setStartStopId: (id: string) => void;
  skipped: Set<string>;
  setSkipped: (s: Set<string>) => void;
}) {
  const startIdx = realStops.findIndex((s) => s.id === startStopId);
  const toggle = (id: string) => {
    const next = new Set(skipped);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSkipped(next);
  };
  return (
    <div>
      <label className="hud-label block mb-2">Bugün Hangi Noktadan Başlıyorsun?</label>
      <select
        value={startStopId}
        onChange={(e) => {
          setStartStopId(e.target.value);
          const idx = realStops.findIndex((s) => s.id === e.target.value);
          // Başlangıçtan önceki noktalar zaten güzergâhtan düşer, atlama işaretlerini temizle
          const next = new Set(skipped);
          realStops.slice(0, Math.max(idx, 0)).forEach((s) => next.delete(s.id));
          setSkipped(next);
        }}
        className="w-full bg-input border border-border rounded-md px-3 py-3 font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {realStops.map((s, i) => (
          <option key={s.id} value={s.id}>
            {i + 1}. {s.kind === "stop" ? "" : "• "}
            {s.name} ({s.lat.toFixed(4)}, {s.lng.toFixed(4)})
          </option>
        ))}
      </select>

      <div className="hud-label mt-5 mb-2">Uğramayacağın Durak / Rota Noktalarını İşaretle</div>

      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
        {realStops.map((s, i) => {
          const before = startIdx >= 0 && i < startIdx;
          const isLast = i === realStops.length - 1;
          const off = before || skipped.has(s.id);
          return (
            <label
              key={s.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-md border ${
                off ? "border-border/50 opacity-50" : "border-border"
              } ${before || isLast ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/40"}`}
            >
              <input
                type="checkbox"
                checked={!off}
                disabled={before || isLast}
                onChange={() => toggle(s.id)}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm font-semibold flex-1">
                {i + 1}. {s.name}
                <span className="ml-2 text-[10px] font-mono text-muted-foreground">
                  {s.kind === "stop" ? "DURAK" : "ROTA"} · {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                </span>
              </span>

              <span className="text-[11px] font-mono text-muted-foreground">
                {before ? "BAŞLANGIÇ ÖNCESİ" : off ? "ATLANDI" : "UĞRANACAK"}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
