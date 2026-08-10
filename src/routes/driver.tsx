import { loadResume, saveResume, clearResume, type ResumePoint } from "@/lib/resume";
import { usePassedStops, trimRoutePath } from "@/lib/passed-stops";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Peer, { type DataConnection } from "peerjs";
import { ClientOnly } from "@/components/ClientOnly";
import { DRIVER_PEER_ID, SERVICE_INFO } from "@/lib/service-config";
import { DRIVER_SESSION_KEY, checkDriverPassword } from "@/lib/driver-auth";
import { getStops, type Stop } from "@/lib/stops";
import { getRoute } from "@/lib/routing";
import { beep, playBase64Audio, speak, type VoiceAlertPayload } from "@/lib/voice-alert";
import type { RadioStatePayload } from "@/lib/radio";
import {
  announceText,
  brakeLevel,
  ensureMotionPermission,
  gpsBrakeG,
  ingestStopDistance,
  initialAnnounceState,
  startBrakeWatch,
  type BrakeEventPayload,
  type StopAnnouncePayload,
} from "@/lib/announce";
import DataSheet from "@/components/DataSheet";
import WeatherCard from "@/components/WeatherCard";
import {
  ARRIVAL_RADIUS_M,
  addDriving,
  closeSession,
  clearDay,
  distanceM,
  loadDay,
  openSession,
  recordArrival,
  saveDay,
  todayKey,
  type DayLog,
  type JourneyPayload,
} from "@/lib/journey-log";

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
const DriverRadio = lazy(() => import("@/components/DriverRadio"));

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
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(DRIVER_SESSION_KEY) === "1",
  );
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (unlocked) return <DriverApp />;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (checkDriverPassword(pw)) {
            sessionStorage.setItem(DRIVER_SESSION_KEY, "1");
            setUnlocked(true);
          } else {
            setErr("Şifre hatalı.");
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
          onChange={(e) => {
            setPw(e.target.value);
            setErr(null);
          }}
          className="w-full bg-input border border-border rounded-md px-4 py-3 font-mono focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {err && <div className="mt-3 text-sm text-red-400">{err}</div>}
        <button
          type="submit"
          className="mt-6 w-full bg-primary text-primary-foreground font-bold py-3 rounded-md hover:bg-primary/90 transition"
        >
          GİRİŞ
        </button>
        <Link to="/" className="hud-label block mt-4 text-center hover:text-primary">
          ← Ana Sayfa
        </Link>
      </form>
    </div>
  );
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
  const [alerts, setAlerts] = useState<VoiceAlertPayload[]>([]);
  const [day, setDay] = useState<DayLog | null>(null);
  const dayRef = useRef<DayLog | null>(null);
  const lastIdleTsRef = useRef<number>(0);
  const [autoStart, setAutoStart] = useState(
    () => localStorage.getItem("acrob-auto-start") !== "0",
  );
  const autoStartRef = useRef(autoStart);
  autoStartRef.current = autoStart;
  const runningRef = useRef(false);
  const prevChargingRef = useRef<boolean | null>(null);
  const idRetryRef = useRef(0);
  const startRef = useRef<() => void>(() => undefined);

  // --- 10. madde: otomatik durak anonsu + ani fren algılama ---
  const [announceOn, setAnnounceOn] = useState(
    () => localStorage.getItem("acrob-stop-announce") !== "0",
  );
  const announceOnRef = useRef(announceOn);
  announceOnRef.current = announceOn;
  const [lastAnnounce, setLastAnnounce] = useState<StopAnnouncePayload | null>(null);
  const [brakes, setBrakes] = useState<BrakeEventPayload[]>([]);
  const [motionReady, setMotionReady] = useState(false);
  const motionReadyRef = useRef(false);
  motionReadyRef.current = motionReady;
  const announceStateRef = useRef(initialAnnounceState());
  const brakePrevRef = useRef<{ kmh: number; ts: number } | null>(null);

  const statsRef = useRef<TripStats>(EMPTY_STATS);
  const filterRef = useRef<FilterState>(initialFilterState());
  const lastSaveRef = useRef<number>(0);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Set<DataConnection>>(new Set());
  const watchIdRef = useRef<number | null>(null);
  const radioStreamRef = useRef<MediaStream | null>(null);

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

  // 14. madde: tam varış + uzaklaşma ile "geçildi" tespiti
  const busPos = position
    ? { lat: position.coords.latitude, lng: position.coords.longitude }
    : null;
  const passedIds = usePassedStops(stops, busPos, position?.coords.accuracy ?? null);
  const activeStops = useMemo(() => stops.filter((s) => !passedIds.has(s.id)), [stops, passedIds]);
  const activeRoutePath = useMemo(
    () => trimRoutePath(routePath, busPos),
    [routePath, busPos?.lat, busPos?.lng],
  );

  // 15. madde: son geçilen durak kaydı + kopma sonrası devam
  const [resume, setResume] = useState<ResumePoint | null>(null);
  const [resumeHandled, setResumeHandled] = useState(false);

  useEffect(() => {
    void loadResume().then(setResume);
  }, []);

  // Geçilen duraklar arasından listedeki en ileri olanı kaydet
  useEffect(() => {
    if (passedIds.size === 0) return;
    let lastIdx = -1;
    allStops.forEach((s, i) => {
      if (passedIds.has(s.id) && i > lastIdx) lastIdx = i;
    });
    const lastStop = lastIdx >= 0 ? allStops[lastIdx] : null;
    if (!lastStop) return;
    const point: ResumePoint = {
      stopId: lastStop.id,
      stopName: lastStop.name,
      index: lastIdx,
      ts: Date.now(),
    };
    setResume(point);
    void saveResume(point);
  }, [passedIds, allStops]);

  const continueFromResume = () => {
    if (!resume) return;
    const next = allStops[resume.index + 1] ?? allStops[resume.index];
    if (next) setStartStopId(next.id);
    setResumeHandled(true);
  };

  const restartFromBeginning = () => {
    if (allStops[0]) setStartStopId(allStops[0].id);
    setResume(null);
    setResumeHandled(true);
    void clearResume();
  };

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

  const lastRadioRef = useRef<RadioStatePayload | null>(null);
  const broadcastRadio = (payload: RadioStatePayload) => {
    lastRadioRef.current = payload;
    connectionsRef.current.forEach((c) => {
      try {
        if (c.open) c.send(payload);
      } catch {
        /* ignore */
      }
    });
  };

  // Durak anonsu / ani fren paketlerini tüm yolculara gönder
  const broadcastEvent = (payload: StopAnnouncePayload | BrakeEventPayload) => {
    connectionsRef.current.forEach((c) => {
      try {
        if (c.open) c.send(payload);
      } catch {
        /* ignore */
      }
    });
  };

  const registerBrake = (g: number, source: "sensör" | "gps") => {
    const payload: BrakeEventPayload = {
      type: "brake",
      g,
      level: brakeLevel(g),
      speedKmh: Math.round(filterRef.current.smoothedKmh),
      source,
      ts: Date.now(),
    };
    setBrakes((prev) => [payload, ...prev].slice(0, 20));
    broadcastEvent(payload);
  };

  // --- 7. madde: günlük hareket kaydı (IndexedDB) ---
  const applyDay = (fn: (d: DayLog) => DayLog) => {
    const cur = dayRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    dayRef.current = next;
    setDay(next);
    void saveDay(next);
    const payload: JourneyPayload = { type: "journey", day: next, ts: Date.now() };
    connectionsRef.current.forEach((c) => {
      try {
        if (c.open) c.send(payload);
      } catch {
        /* ignore */
      }
    });
  };

  useEffect(() => {
    void loadDay(todayKey()).then((d) => {
      dayRef.current = d;
      setDay(d);
    });
  }, []);

  // Kontak hack'i: şarj başladı = kontak açık, kesildi = duruş
  // NOT: gün kaydı (hareket saatleri) her durumda işlenir; yayın ise SADECE
  // gerçek bir "şarj yok -> şarj var" geçişinde otomatik başlar. Sayfa açılışında
  // zaten şarjdaysa otomatik başlamaz; böylece açık kalan başka bir sekme/cihaz
  // sabit yayın kimliğini kendiliğinden kapmaz.
  useEffect(() => {
    let battery: (EventTarget & { charging: boolean }) | null = null;
    const onChange = () => {
      if (!battery) return;
      const charging = battery.charging;
      applyDay((d) => (charging ? openSession(d) : closeSession(d)));
      const prev = prevChargingRef.current;
      prevChargingRef.current = charging;
      if (prev === null) return; // ilk okuma: otomatik başlatma yok
      if (charging && !prev && autoStartRef.current && !runningRef.current) {
        startRef.current();
      }
    };
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<EventTarget & { charging: boolean }>;
    };
    nav
      .getBattery?.()
      .then((b) => {
        battery = b;
        b.addEventListener("chargingchange", onChange);
        onChange();
      })
      .catch(() => undefined);
    return () => battery?.removeEventListener("chargingchange", onChange);
  }, []);

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
    if (runningRef.current) return;
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
      idRetryRef.current = 0;
      setError(null);
      setPeerReady(true);
      setRunning(true);
      runningRef.current = true;
      applyDay((d) => openSession(d));
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
        if (dayRef.current) {
          try {
            conn.send({ type: "journey", day: dayRef.current, ts: Date.now() } as JourneyPayload);
          } catch {
            /* ignore */
          }
        }
        // Radyo yayını açıksa yeni yolcuyu da hemen bağla
        if (lastRadioRef.current) {
          try {
            conn.send({ ...lastRadioRef.current, ts: Date.now() });
          } catch {
            /* ignore */
          }
        }
        if (radioStreamRef.current) {
          try {
            peerRef.current?.call(conn.peer, radioStreamRef.current);
          } catch {
            /* ignore */
          }
        }
      });
      conn.on("data", (data) => {
        const p = data as VoiceAlertPayload;
        if (p?.type !== "alert") return;
        setAlerts((prev) => [p, ...prev].slice(0, 20));
        beep();
        window.setTimeout(() => {
          if (p.kind === "voice" && p.audio) {
            void playBase64Audio(p.audio, p.mime ?? "audio/webm");
          } else {
            speak(p.text ?? `${p.stopName ?? "Bir"} durağındaki yolcu bugün gelmiyor.`);
          }
        }, 350);
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
        // Eski oturum sunucuda hâlâ kayıtlı olabilir (sekme kapansa da ~1-2 dk sürer).
        // Kısa aralıklarla yeniden dene, kullanıcıyı bekletmeden devral.
        stopInternal();
        if (idRetryRef.current < 6) {
          idRetryRef.current += 1;
          setError(
            `Önceki yayın oturumu kapanıyor, kimlik devralınıyor… (${idRetryRef.current}/6)`,
          );
          window.setTimeout(() => startRef.current(), 5000);
        } else {
          idRetryRef.current = 0;
          setError(
            "Bu servis şu an başka bir cihazdan yayınlanıyor. Diğer cihazdaki yayını durdurup tekrar deneyin.",
          );
        }
        return;
      }
      setError(`Bağlantı hatası: ${err.message}`);
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
        // 10.2 GPS yedeği: ivmeölçer yoksa hız düşüşünden ani fren çıkar
        const prevSpeed = brakePrevRef.current;
        if (!motionReadyRef.current && prevSpeed) {
          const gB = gpsBrakeG(prevSpeed.kmh, res.speedKmh, (now - prevSpeed.ts) / 1000);
          if (gB > 0) registerBrake(gB, "gps");
        }
        brakePrevRef.current = { kmh: res.speedKmh, ts: now };
        // Kontak API'si olmayan cihazlarda hareket/duruş yedeği
        if (res.speedKmh > 5) {
          lastIdleTsRef.current = now;
          applyDay((d) => openSession(d, now));
        } else if (now - lastIdleTsRef.current > 180000 && lastIdleTsRef.current > 0) {
          applyDay((d) => closeSession(d, now));
        }
        // Durak varış saatleri (100 m yakınlık, gün içinde tek kayıt)
        // + 10.1 Otomatik durak anonsu (350 m yakınlık, durak başına bir kez)
        stopsRef.current
          .filter((s) => s.kind === "stop")
          .forEach((s) => {
            const dm = distanceM(
              { lat: pos.coords.latitude, lng: pos.coords.longitude },
              { lat: s.lat, lng: s.lng },
            );
            if (dm <= ARRIVAL_RADIUS_M) applyDay((d) => recordArrival(d, s.id, s.name, now));
            if (ingestStopDistance(announceStateRef.current, s.id, dm)) {
              const payload: StopAnnouncePayload = {
                type: "announce",
                stopId: s.id,
                stopName: s.name,
                distanceM: Math.round(dm),
                ts: Date.now(),
              };
              setLastAnnounce(payload);
              broadcastEvent(payload);
              if (announceOnRef.current) speak(announceText(s.name));
            }
          });

        if (res.accepted) {
          // 8. madde: günlük mesafe ve fiili hareket süresi
          const dMeters = res.stats.totalMeters - statsRef.current.totalMeters;
          const dSeconds = res.stats.movingSeconds - statsRef.current.movingSeconds;
          if (dMeters > 0 && dSeconds > 0 && res.speedKmh > 5) {
            applyDay((d) => addDriving(d, dMeters, dSeconds));
          }
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
          maxSpeedKmh: statsRef.current.maxSpeedKmh,
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
    maxSpeedKmh: number;
    heading: number | null;
    plate: string;
    ts: number;
  } | null>(null);

  const stopInternal = () => {
    runningRef.current = false;
    applyDay((d) => closeSession(d));
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
  startRef.current = start;

  // 10.2 Ani fren algılama: yayın açıkken ivmeölçeri dinle
  useEffect(() => {
    if (!running) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void ensureMotionPermission().then((ok) => {
      if (cancelled) return;
      setMotionReady(ok);
      if (!ok) return;
      stop = startBrakeWatch((g) => registerBrake(g, "sensör"));
    });
    return () => {
      cancelled = true;
      stop?.();
      setMotionReady(false);
    };
  }, [running]);

  // Sekme kapanırken/arka plana atılırken yayın kimliğini sunucuda serbest bırak
  useEffect(() => {
    const release = () => {
      if (!runningRef.current && !peerRef.current) return;
      try {
        connectionsRef.current.forEach((c) => c.close());
        peerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      peerRef.current = null;
      runningRef.current = false;
    };
    window.addEventListener("pagehide", release);
    window.addEventListener("beforeunload", release);
    return () => {
      window.removeEventListener("pagehide", release);
      window.removeEventListener("beforeunload", release);
    };
  }, []);

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
          <DataSheet
            day={day}
            history
            onReset={async () => {
              const fresh = await clearDay(todayKey());
              dayRef.current = fresh;
              setDay(fresh);
            }}
          />
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

            {resume && !resumeHandled && (
              <div className="mt-6 rounded-md border border-primary/40 bg-primary/10 p-4">
                <div className="hud-label mb-1">Yarım Kalan Sefer</div>
                <p className="text-sm">
                  Son geçilen durak: <strong>{resume.stopName}</strong> ·{" "}
                  {new Date(resume.ts).toLocaleTimeString("tr-TR")}
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={continueFromResume}
                    className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
                  >
                    Kaldığım yerden devam et
                  </button>
                  <button
                    onClick={restartFromBeginning}
                    className="px-4 py-2 rounded-md border border-border text-sm font-semibold hover:bg-muted"
                  >
                    Baştan başla
                  </button>
                </div>
              </div>
            )}

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
            <label className="mt-4 flex items-center gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => {
                  setAutoStart(e.target.checked);
                  localStorage.setItem("acrob-auto-start", e.target.checked ? "1" : "0");
                }}
                className="w-4 h-4 accent-primary"
              />
              <span>
                Araç kontağı açılınca (telefon şarja girince) yayını{" "}
                <strong>otomatik başlat</strong>
              </span>
            </label>
            <Link to="/rapor" className="hud-label block mt-4 text-center hover:text-primary">
              → Haftalık Sürüş Raporu
            </Link>
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

            <WeatherCard
              position={
                position ? { lat: position.coords.latitude, lng: position.coords.longitude } : null
              }
            />

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

            {/* 10. madde: durak anonsu + ani fren */}
            <div className="panel p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="hud-label">Durak Anonsu & Ani Fren</div>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {motionReady ? "İVMEÖLÇER AKTİF" : "GPS YEDEĞİ"}
                </span>
              </div>

              <label className="flex items-center gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={announceOn}
                  onChange={(e) => {
                    setAnnounceOn(e.target.checked);
                    localStorage.setItem("acrob-stop-announce", e.target.checked ? "1" : "0");
                  }}
                  className="w-4 h-4 accent-primary"
                />
                <span>
                  Durağa 350 m kalınca <strong>sesli anons</strong> yap (yolculara da gider)
                </span>
              </label>

              <div className="mt-3 rounded-md border border-border p-3">
                <div className="hud-label mb-1">Son Anons</div>
                <div className="font-bold truncate">
                  {lastAnnounce ? lastAnnounce.stopName : "—"}
                </div>
                {lastAnnounce && (
                  <div className="text-[11px] font-mono text-muted-foreground mt-1">
                    {new Date(lastAnnounce.ts).toLocaleTimeString("tr-TR")} ·{" "}
                    {lastAnnounce.distanceM} m
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between mt-4 mb-2">
                <div className="hud-label">Ani Fren Kayıtları</div>
                {brakes.length > 0 && (
                  <button
                    onClick={() => setBrakes([])}
                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50"
                  >
                    Temizle
                  </button>
                )}
              </div>
              {brakes.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Ani fren algılanmadı. Sert frenler burada ve yolcuların ekranında listelenir.
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
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
                          {new Date(b.ts).toLocaleTimeString("tr-TR")} · {b.speedKmh} km/s ·{" "}
                          {b.source}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Suspense fallback={null}>
              <DriverRadio
                peerRef={peerRef}
                connectionsRef={connectionsRef}
                radioStreamRef={radioStreamRef}
                broadcast={broadcastRadio}
              />
            </Suspense>

            <div className="panel p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="hud-label">Yolcu Uyarıları (sesli)</div>
                {alerts.length > 0 && (
                  <button
                    onClick={() => setAlerts([])}
                    className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50"
                  >
                    Temizle
                  </button>
                )}
              </div>
              {alerts.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  Henüz uyarı yok. Yolcular mikrofonla "ben yokum" dediğinde burada sesli olarak
                  duyacaksın.
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                  {alerts.map((a) => (
                    <div
                      key={a.ts}
                      className="flex items-center gap-3 px-3 py-2 rounded-md border border-border"
                    >
                      <span className="text-lg">{a.kind === "voice" ? "🎙" : "🙅"}</span>
                      <div className="flex-1 text-sm">
                        <div className="font-semibold">{a.stopName ?? "Bilinmeyen durak"}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">
                          {new Date(a.ts).toLocaleTimeString("tr-TR")} ·{" "}
                          {a.kind === "voice" ? "SESLİ MESAJ" : "GELMİYOR"}
                        </div>
                      </div>
                      {a.kind === "voice" && a.audio && (
                        <button
                          onClick={() => void playBase64Audio(a.audio!, a.mime ?? "audio/webm")}
                          className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted/50"
                        >
                          ▶ Dinle
                        </button>
                      )}
                      {a.stopId && !skipped.has(a.stopId) && (
                        <button
                          onClick={() => {
                            const next = new Set(skipped);
                            next.add(a.stopId!);
                            setSkipped(next);
                          }}
                          className="text-xs px-3 py-1.5 rounded-md bg-destructive text-destructive-foreground"
                        >
                          Durağı Atla
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="panel overflow-hidden flex-1 min-h-[400px]">
              <Suspense fallback={null}>
                <MapView
                  stops={activeStops}
                  busPosition={busPos}
                  routePath={activeRoutePath}
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
