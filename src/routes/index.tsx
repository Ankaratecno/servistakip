import { usePassedStops, trimRoutePath } from "@/lib/passed-stops";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Peer, { type DataConnection } from "peerjs";
import { ClientOnly } from "@/components/ClientOnly";
import { DRIVER_PEER_ID, SERVICE_INFO } from "@/lib/service-config";
import { getStops, type Stop } from "@/lib/stops";
import { getRoute, getRouteEta, formatEta, type RouteEtaResult } from "@/lib/routing";
import { blobToBase64, pickRecorderMime, speak, type VoiceAlertPayload } from "@/lib/voice-alert";
import {
  announceText,
  type BrakeEventPayload,
  type StopAnnouncePayload,
} from "@/lib/announce";
import {
  alarmTone,
  ensureNotificationPermission,
  ingestDistance,
  initialApproachState,
  isApproachAlertOn,
  notify,
  setApproachAlertOn,
  vibrate,
  type ApproachStage,
} from "@/lib/approach-alert";

import type { RadioStatePayload } from "@/lib/radio";
import DataSheet from "@/components/DataSheet";
import WeatherCard from "@/components/WeatherCard";
import type { DayLog, JourneyPayload } from "@/lib/journey-log";

const MapView = lazy(() => import("@/components/MapView"));

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
  maxSpeedKmh?: number;
  heading: number | null;
  plate: string;
  ts: number;
}

interface DriverRoutePayload {
  type: "route";
  stops: Stop[];
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
  const [baseStops, setBaseStops] = useState<Stop[]>([]);
  // Şoförün o sabah yayınladığı aktif güzergâh (atlanan duraklar çıkarılmış)
  const [driverStops, setDriverStops] = useState<Stop[] | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "offline">("idle");
  const [driver, setDriver] = useState<DriverPayload | null>(null);
  const [eta, setEta] = useState<RouteEtaResult | null>(null);
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const [radio, setRadio] = useState<RadioStatePayload | null>(null);
  const [day, setDay] = useState<DayLog | null>(null);
  const [radioOn, setRadioOn] = useState(false);
  const [radioVolume, setRadioVolume] = useState(0.9);
  const radioAudioRef = useRef<HTMLAudioElement | null>(null);
  // --- 10. madde: durak anonsu + ani fren (şoförden canlı gelir) ---
  const [announce, setAnnounce] = useState<StopAnnouncePayload | null>(null);
  const [brakes, setBrakes] = useState<BrakeEventPayload[]>([]);
  const [announceOn, setAnnounceOn] = useState(true);
  const announceOnRef = useRef(true);
  announceOnRef.current = announceOn;
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stops = driverStops ?? baseStops;

  // 14. madde: tam varış + uzaklaşma sonrası geçilen durak/rota temizliği
  const busPos = driver ? { lat: driver.lat, lng: driver.lng } : null;
  const passedIds = usePassedStops(stops, busPos, null);
  const activeStops = useMemo(() => stops.filter((s) => !passedIds.has(s.id)), [stops, passedIds]);
  const activeRoutePath = useMemo(
    () => trimRoutePath(routePath, busPos),
    [routePath, busPos?.lat, busPos?.lng],
  );


  useEffect(() => {
    setBaseStops(getStops());
  }, []);

  // Seçili durak aktif güzergâhta yoksa ilk gerçek durağa geç
  useEffect(() => {
    const realStops = stops.filter((s) => s.kind === "stop");
    if (realStops.length === 0) return;
    if (!selectedStopId || !realStops.some((s) => s.id === selectedStopId)) {
      setSelectedStopId(realStops[0]!.id);
    }
  }, [stops, selectedStopId]);

  // Güzergâh çizgisini çek (şoför güzergâhı değişince yeniden çizilir)
  useEffect(() => {
    if (stops.length < 2) return;
    let cancelled = false;
    getRoute(stops).then((r) => {
      if (!cancelled && r) setRoutePath(r.path);
    });
    return () => {
      cancelled = true;
    };
  }, [stops]);

  // PeerJS ile şoföre bağlan
  useEffect(() => {
    if (baseStops.length === 0) return;
    const peer = new Peer({ debug: 1 });
    peerRef.current = peer;

    const connect = () => {
      setStatus("connecting");
      const conn = peer.connect(DRIVER_PEER_ID, { reliable: true });
      connRef.current = conn;
      conn.on("open", () => setStatus("connected"));
      conn.on("data", (data) => {
        const p = data as
          | DriverPayload
          | DriverRoutePayload
          | RadioStatePayload
          | JourneyPayload
          | StopAnnouncePayload
          | BrakeEventPayload;
        if (p?.type === "position") setDriver(p as DriverPayload);
        else if (p?.type === "radio") setRadio(p as RadioStatePayload);
        else if (p?.type === "journey") setDay((p as JourneyPayload).day);
        else if (p?.type === "announce") {
          const a = p as StopAnnouncePayload;
          setAnnounce(a);
          if (announceOnRef.current) {
            vibrate([200, 100, 200]);
            speak(announceText(a.stopName));
          }
        } else if (p?.type === "brake") {
          const b = p as BrakeEventPayload;
          setBrakes((prev) => [b, ...prev].slice(0, 20));
          if (b.level === "sert") vibrate([120, 60, 120]);
        } else if (p?.type === "route") {
          const incoming = (p as DriverRoutePayload).stops;
          if (Array.isArray(incoming) && incoming.length >= 2) setDriverStops(incoming);
        }
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

    // Şoförün radyo yayını (WebRTC media call)
    peer.on("call", (call) => {
      try {
        call.answer();
      } catch {
        /* ignore */
      }
      call.on("stream", (stream) => {
        const el = radioAudioRef.current;
        if (!el) return;
        el.srcObject = stream;
        el.volume = radioVolume;
        void el.play().catch(() => {
          /* kullanıcı "Sesi Aç"a basınca çalacak */
        });
      });
    });

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
  }, [baseStops.length]);

  useEffect(() => {
    const el = radioAudioRef.current;
    if (el) {
      el.volume = radioVolume;
      el.muted = !radioOn;
      if (radioOn) void el.play().catch(() => undefined);
    }
  }, [radioOn, radioVolume]);

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

  // --- 9. madde: "Servis Geliyor" uyarısı (500 m titreşim, 200 m alarm + bildirim) ---
  const [alertOn, setAlertOn] = useState(true);
  const [notifyReady, setNotifyReady] = useState(false);
  const [approachStage, setApproachStage] = useState<ApproachStage>("far");
  const approachRef = useRef(initialApproachState());

  useEffect(() => {
    setAlertOn(isApproachAlertOn());
    if (typeof Notification !== "undefined") setNotifyReady(Notification.permission === "granted");
  }, []);

  // Durak değişince eşikler sıfırlanır
  useEffect(() => {
    approachRef.current = initialApproachState();
    setApproachStage("far");
  }, [selectedStopId]);

  useEffect(() => {
    const d = eta?.distanceM;
    if (d == null || !selectedStop) return;
    const ev = ingestDistance(approachRef.current, d);
    setApproachStage(ev.stage);
    if (!ev.changed || !alertOn) return;
    if (ev.stage === "near") {
      vibrate([300, 150, 300]);
      notify("Servis yaklaşıyor", `${selectedStop.name} durağına 500 metre kaldı.`);
    } else if (ev.stage === "arriving") {
      vibrate([600, 200, 600, 200, 600]);
      alarmTone();
      speak(`Servis geliyor. ${selectedStop.name} durağına 200 metre kaldı.`);
      notify("Servis geliyor!", `${selectedStop.name} durağına 200 metre kaldı.`);
    }
  }, [eta?.distanceM, selectedStop?.id, alertOn]);


  return (
    <div className="min-h-screen flex flex-col">
      <Header right={<DataSheet day={day} />} />

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
            <div className="flex items-center justify-between mb-2">
              <div className="hud-label">Servis Radyosu</div>
              <span className="text-[11px] font-mono text-muted-foreground">
                {radio?.playing ? "CANLI" : "YAYIN YOK"}
              </span>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="hud-label mb-1">Şu An Çalıyor</div>
              <div className="font-bold truncate">
                {radio?.playing && radio.title ? radio.title : "—"}
              </div>
              {radio && radio.total > 0 && (
                <div className="text-[11px] font-mono text-muted-foreground mt-1">
                  {radio.index + 1}/{radio.total}
                </div>
              )}
            </div>
            <button
              onClick={() => setRadioOn((v) => !v)}
              className={`mt-3 w-full py-3 rounded-md font-bold tracking-wide transition ${
                radioOn
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-border hover:bg-muted/50"
              }`}
            >
              {radioOn ? "🔊 Radyo Açık" : "🔈 Radyoyu Aç"}
            </button>
            <div className="flex items-center gap-3 mt-3">
              <span className="hud-label">Ses</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={radioVolume}
                onChange={(e) => setRadioVolume(Number(e.target.value))}
                className="flex-1 accent-primary"
                aria-label="Radyo ses seviyesi"
              />
              <span className="text-xs font-mono w-10 text-right">
                {Math.round(radioVolume * 100)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Şoför müzik yayınına başladığında ses otomatik gelir; tarayıcı izni için bir kez
              "Radyoyu Aç"a dokunman gerekebilir.
            </p>
            <audio ref={radioAudioRef} autoPlay playsInline className="hidden" />
          </div>

          <DriverAlertPanel
            connected={status === "connected"}
            stop={selectedStop}
            send={(p) => {
              const c = connRef.current;
              if (!c || !c.open) return false;
              try {
                c.send(p);
                return true;
              } catch {
                return false;
              }
            }}
          />

          <div className="panel p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="hud-label">Servis Geliyor Uyarısı</div>
              <button
                onClick={() => {
                  const next = !alertOn;
                  setAlertOn(next);
                  setApproachAlertOn(next);
                }}
                className={`text-xs font-bold px-3 py-1.5 rounded-md border transition ${
                  alertOn
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
                aria-pressed={alertOn}
              >
                {alertOn ? "AÇIK" : "KAPALI"}
              </button>
            </div>
            <div className="text-sm">
              {approachStage === "arriving" ? (
                <span className="text-primary font-bold">🚨 Servis geliyor — 200 m içinde!</span>
              ) : approachStage === "near" ? (
                <span className="font-semibold">📳 Servis yaklaşıyor — 500 m içinde</span>
              ) : (
                <span className="text-muted-foreground">
                  500 m kala titreşim, 200 m kala alarm + bildirim gönderilir.
                </span>
              )}
            </div>
            {eta && (
              <div className="text-[11px] font-mono text-muted-foreground mt-1">
                DURAĞA KALAN: {Math.round(eta.distanceM)} M
              </div>
            )}
            {!notifyReady && (
              <button
                onClick={() => void ensureNotificationPermission().then(setNotifyReady)}
                className="mt-3 w-full py-2.5 rounded-md border border-border text-sm font-semibold hover:bg-muted/50 transition"
              >
                🔔 Bildirim İznini Ver
              </button>
            )}
          </div>

          <WeatherCard
            position={driver ? { lat: driver.lat, lng: driver.lng } : null}
            subtitle="Servisin bulunduğu noktanın anlık havası · Open-Meteo (ücretsiz)"
          />

          {/* 10. madde: otomatik durak anonsu + ani fren bilgisi */}
          <div className="panel p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="hud-label">Durak Anonsu & Ani Fren</div>
              <button
                onClick={() => setAnnounceOn((v) => !v)}
                className={`text-xs font-bold px-3 py-1.5 rounded-md border transition ${
                  announceOn
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                }`}
                aria-pressed={announceOn}
              >
                {announceOn ? "SESLİ" : "SESSİZ"}
              </button>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="hud-label mb-1">Yaklaşan Durak</div>
              <div className="font-bold truncate">{announce ? announce.stopName : "—"}</div>
              {announce && (
                <div className="text-[11px] font-mono text-muted-foreground mt-1">
                  {new Date(announce.ts).toLocaleTimeString("tr-TR")} · {announce.distanceM} M
                </div>
              )}
            </div>

            <div className="hud-label mt-4 mb-2">Ani Fren</div>
            {brakes.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                Ani fren algılanmadı. Sert frenler burada anında listelenir.
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-1">
                {brakes.map((b) => (
                  <div
                    key={b.ts}
                    className="flex items-center gap-3 px-3 py-2 rounded-md border border-border text-sm"
                  >
                    <span className="text-lg">{b.level === "sert" ? "🛑" : "⚠️"}</span>
                    <div className="flex-1">
                      <div className="font-semibold">
                        {b.level === "sert" ? "Sert fren" : "Ani fren"} · {b.g.toFixed(2)} g
                      </div>
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {new Date(b.ts).toLocaleTimeString("tr-TR")} · {b.speedKmh} km/s
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>




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
              {(driver.avgSpeedKmh !== undefined ||
                driver.totalKm !== undefined ||
                driver.maxSpeedKmh !== undefined) && (
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <div>
                    <div className="hud-label mb-1">Ortalama Hız</div>
                    <div className="text-xl font-mono font-bold">
                      {Math.round(driver.avgSpeedKmh ?? 0)}
                      <span className="text-xs text-muted-foreground ml-1">km/s</span>
                    </div>
                  </div>
                  <div>
                    <div className="hud-label mb-1">Zirve Hız</div>
                    <div className="text-xl font-mono font-bold">
                      {Math.round(driver.maxSpeedKmh ?? 0)}
                      <span className="text-xs text-muted-foreground ml-1">km/s</span>
                    </div>
                  </div>
                  <div>
                    <div className="hud-label mb-1">Toplam KM</div>
                    <div className="text-xl font-mono font-bold">
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
        <div className="flex-1 panel overflow-hidden h-[65vh] min-h-[400px] lg:h-[calc(100vh-8rem)] lg:min-h-[600px] lg:max-h-[800px] lg:self-start lg:sticky lg:top-4">
          <Suspense fallback={null}>
            <MapView
              stops={activeStops}
              selectedStopId={selectedStopId}
              busPosition={busPos}
              routePath={activeRoutePath}

              className="h-full"
            />
          </Suspense>
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

function DriverAlertPanel({
  connected,
  stop,
  send,
}: {
  connected: boolean;
  stop: Stop | null;
  send: (p: VoiceAlertPayload) => boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const sendAbsent = () => {
    const ok = send({
      type: "alert",
      kind: "absent",
      text: `${stop?.name ?? "Durak"} durağındaki yolcu bugün gelmiyor.`,
      stopId: stop?.id ?? null,
      stopName: stop?.name ?? null,
      ts: Date.now(),
    });
    setErr(ok ? null : "Şoföre ulaşılamadı, servis çevrimdışı.");
    setInfo(ok ? "Şoföre 'ben yokum' uyarısı gönderildi." : null);
  };

  const startRec = async () => {
    setErr(null);
    setInfo(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickRecorderMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        const audio = await blobToBase64(blob);
        const ok = send({
          type: "alert",
          kind: "voice",
          audio,
          mime: mime || "audio/webm",
          text: `${stop?.name ?? "Durak"} durağından sesli mesaj`,
          stopId: stop?.id ?? null,
          stopName: stop?.name ?? null,
          ts: Date.now(),
        });
        setErr(ok ? null : "Şoföre ulaşılamadı, servis çevrimdışı.");
        setInfo(ok ? "Sesli uyarı şoföre gönderildi." : null);
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      setErr("Mikrofon izni verilmedi.");
    }
  };

  const stopRec = () => {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  };

  return (
    <div className="panel p-5">
      <div className="hud-label mb-2">Şoföre Uyarı</div>
      <p className="text-xs text-muted-foreground mb-3">
        Mikrofona konuşarak şoföre erken uyarı gönder. Örn: "Ben bugün yokum, durağa uğrama."
      </p>
      <button
        onClick={recording ? stopRec : startRec}
        disabled={!connected}
        className={`w-full py-3 rounded-md font-bold tracking-wide transition disabled:opacity-40 disabled:cursor-not-allowed ${
          recording
            ? "bg-destructive text-destructive-foreground animate-pulse"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        {recording ? "⏹ KAYDI BİTİR VE GÖNDER" : "🎙 SESLİ UYARI GÖNDER"}
      </button>
      <button
        onClick={sendAbsent}
        disabled={!connected}
        className="mt-2 w-full py-2.5 rounded-md border border-border text-sm font-semibold hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        🙅 Bugün Yokum (hızlı uyarı)
      </button>
      {!connected && (
        <div className="mt-3 text-xs text-muted-foreground">
          Servis çevrimdışı; şoför yayına başlayınca gönderebilirsiniz.
        </div>
      )}
      {info && <div className="mt-3 text-xs text-primary">{info}</div>}
      {err && <div className="mt-3 text-xs text-red-400">{err}</div>}
    </div>
  );
}

function Header({ right }: { right?: React.ReactNode }) {
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
        {right}
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
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold uppercase tracking-wider">{map.text}</span>
        <span className="text-[11px] font-mono text-muted-foreground">
          {SERVICE_INFO.plate} · {SERVICE_INFO.driverName}
        </span>
      </div>
    </div>
  );
}
