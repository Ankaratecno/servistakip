import { loadResume, saveResume, clearResume, type ResumePoint } from "@/lib/resume";
import { usePassedStops, useTrimmedRoutePath } from "@/lib/passed-stops";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import Peer, { type DataConnection } from "peerjs";
import {
  PEER_OPTIONS,
  reconnectDelay,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  watchIceState,
  tryIceRestart,
  checkTurnReachable,
  readConnectionQuality,
  type RelayStatus,
  type PingPayload,
  type PongPayload,
} from "@/lib/peer-config";
import { isWakeLockSupported, keepScreenAwake, releaseScreenAwake } from "@/lib/wake-lock";
import { ClientOnly } from "@/components/ClientOnly";
import { DRIVER_PEER_ID, SERVICE_INFO } from "@/lib/service-config";
import { DRIVER_SESSION_KEY, checkDriverPassword } from "@/lib/driver-auth";
import { getStops, type Stop } from "@/lib/stops";
import { getRoute } from "@/lib/routing";
import {
  beep,
  playBase64Audio,
  speak,
  squelchClose,
  squelchOpen,
  type VoiceAlertPayload,
} from "@/lib/voice-alert";
import type { RadioStatePayload } from "@/lib/radio";
import type { RadioAckPayload, RadioRequestPayload } from "@/lib/radio";
import { ingestSongPacket } from "@/lib/song-request";
import { groupRiders, type PresencePayload, type Rider } from "@/lib/riders";
import {
  mergeBoard,
  type GuessBoardPayload,
  type GuessBoardRow,
  type GuessScorePayload,
} from "@/lib/guess-game";
import {
  audioStats,
  callPeer,
  clearCalls,
  forgetPeer,
  markAudioOk,
  reconcileCalls,
} from "@/lib/radio-calls";
import {
  brakeLevel,
  ensureMotionPermission,
  gpsBrakeG,
  ingestStopDistance,
  initialAnnounceState,
  resetAnnounce,
  startBrakeWatch,
  type BrakeEventPayload,
  type StopAnnouncePayload,
} from "@/lib/announce";
import {
  announceDistanceM,
  effectiveDistanceM,
  etaSeconds,
  headingAgrees,
  ingestTrend,
  initialTrendState,
  nextStop as pickNextStop,
} from "@/lib/route-progress";
import { ingestAutoAnnounce, initialAutoAnnounceState } from "@/lib/auto-stop-announce";
import { ingestDepartureGreeting, initialDepartureGreetingState } from "@/lib/departure-greeting";
import DataSheet from "@/components/DataSheet";
import WeatherCard from "@/components/WeatherCard";
import {
  ARRIVAL_RADIUS_M,
  addDriving,
  closeSession,
  clearDay,
  diffDay,
  distanceM,
  flushDay,
  loadDay,
  openSession,
  recordArrival,
  saveDayBatched,
  todayKey,
  type DayLog,
  type JourneyDeltaPayload,
  type JourneyPayload,
} from "@/lib/journey-log";

import {
  avgSpeedKmh,
  accuracyLabel,
  loadStats,
  resetStats,
  saveStats,
  EMPTY_STATS,
  ingestFix,
  initialFilterState,
  type FilterState,
  type TripStats,
} from "@/lib/trip-stats";

/** #69: "yayın açık kalsın" niyeti — sayfa yenilense bile otomatik geri döner. */
const LIVE_WANT_KEY = "acrob-live-want";

const DRIVER_TABS = [
  { id: "rota", label: "Rota", icon: "🛣️" },
  { id: "hiz", label: "Hız", icon: "⚡" },
  { id: "radyo", label: "Radyo", icon: "📻" },
  { id: "uyari", label: "Uyarı", icon: "🔔" },
  { id: "harita", label: "Harita", icon: "🗺️" },
] as const;

const MapView = lazy(() => import("@/components/MapView"));
const DriverRadio = lazy(() => import("@/components/DriverRadio"));
import busDriverIcon from "@/assets/crafter-b.svg";

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

/** Yolculara giden canlı konum paketi (YAPILACAKLAR3 #1/#2: fixTs + ageMs). */
interface PositionPayload {
  type: "position";
  lat: number;
  lng: number;
  speedKmh: number;
  avgSpeedKmh: number;
  totalKm: number;
  maxSpeedKmh: number;
  heading: number | null;
  plate: string;
  accuracyM: number;
  calibrating: boolean;
  fixTs: number;
  ageMs: number;
  ts: number;
}

function DriverApp() {
  const [tab, setTab] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeBlockedRef = useRef(false);
  const [plate] = useState(SERVICE_INFO.plate);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [peerReady, setPeerReady] = useState(false);
  const [awake, setAwake] = useState(false);
  const [gpsWarn, setGpsWarn] = useState<string | null>(null);
  const [connCount, setConnCount] = useState(0);
  // Hangi durakta kaç yolcu takip ediyor (yolcunun seçtiği durak bilgisi)
  const [riders, setRiders] = useState<Rider[]>([]);
  // Tüm noktalar listelenir; durak yönetiminde tiki kaldırılmış olanlar
  // burada varsayılan olarak "ATLANDI" gelir ama şoför gerektiğinde tek dokunuşla
  // güzergâha geri alabilir (admin paneline uğramadan).
  const [allStops] = useState<Stop[]>(() => getStops());
  const [startStopId, setStartStopId] = useState<string>("");
  const [skipped, setSkipped] = useState<Set<string>>(
    () =>
      new Set(
        getStops()
          .filter((s) => !s.active)
          .map((s) => s.id),
      ),
  );
  const riderGroups = useMemo(
    () =>
      groupRiders(
        riders,
        allStops.map((s) => s.id),
      ),
    [riders, allStops],
  );
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  const [stats, setStats] = useState<TripStats>(EMPTY_STATS);
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [liveHeading, setLiveHeading] = useState<number | null>(null);
  const [alerts, setAlerts] = useState<VoiceAlertPayload[]>([]);
  // Okunmamış yolcu uyarısı sayısı (Uyarı sekmesinde rozet olarak gösterilir)
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  // Sürüş sırasında pencere açmak yerine kısa bir alt bant gösterilir
  const [alertToast, setAlertToast] = useState<VoiceAlertPayload | null>(null);
  const tabRef = useRef(0);
  tabRef.current = tab;
  const toastTimerRef = useRef<number | null>(null);
  // Uyarı sekmesi açıldığında rozet sıfırlanır
  useEffect(() => {
    if (tab === 3) setUnreadAlerts(0);
  }, [tab]);
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
  const [lastAnnounce, setLastAnnounce] = useState<StopAnnouncePayload | null>(null);
  const [brakes, setBrakes] = useState<BrakeEventPayload[]>([]);
  // Durak tahmini oyunu sıralaması (şoför derler, yolculara dağıtır)
  const guessBoardRef = useRef<GuessBoardRow[]>([]);
  const [motionReady, setMotionReady] = useState(false);
  const motionReadyRef = useRef(false);
  motionReadyRef.current = motionReady;
  const announceStateRef = useRef(initialAnnounceState());
  // Konuma göre otomatik radyo anonsu (25 Saat Fırın 2 dk + 30 sn, Eloktroland 30 sn)
  const autoAnnounceRef = useRef(initialAutoAnnounceState());
  // 1. ve 9. duraktan kalkışta karşılama anonsu
  const greetingRef = useRef(initialDepartureGreetingState());
  const [lastAutoAnnounce, setLastAutoAnnounce] = useState<{ label: string; ts: number } | null>(
    null,
  );
  const brakePrevRef = useRef<{ kmh: number; ts: number } | null>(null);

  const statsRef = useRef<TripStats>(EMPTY_STATS);
  const filterRef = useRef<FilterState>(initialFilterState());
  const lastSaveRef = useRef<number>(0);

  const peerRef = useRef<Peer | null>(null);
  const connectionsRef = useRef<Set<DataConnection>>(new Set());
  const watchIdRef = useRef<number | null>(null);
  const radioStreamRef = useRef<MediaStream | null>(null);
  // YAPILACAKLAR3 #1/#5/#10: kalp atışı, fix watchdog'u ve düşük hassasiyet yedeği
  const lastFixTsRef = useRef<number>(0);
  const gpsRetryRef = useRef(0);
  const lowAccuracyRef = useRef(false);
  const [fixAgeMs, setFixAgeMs] = useState<number | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  // YAPILACAKLAR3 #16/#17/#18: ICE izleme, pong takibi ve röle (TURN) durumu
  const lastPongRef = useRef<Map<string, number>>(new Map());
  const iceStopRef = useRef<Map<string, () => void>>(new Map());
  const [relayStatus, setRelayStatus] = useState<RelayStatus>("unknown");
  // #65: yolcu bağlantı kalitesi (en kötü gecikme, röle üzerinden akan bağlantı sayısı)
  const [linkQuality, setLinkQuality] = useState<{ rttMs: number | null; relay: number }>({
    rttMs: null,
    relay: 0,
  });
  const lastBroadcastRef = useRef<number>(0);
  /** #42: aracın ne zamandır durduğu (ms epoch, 0 = hareket halinde) */
  const stoppedSinceRef = useRef<number>(0);
  // YAPILACAKLAR3 #27: radyo yayınını gerçekten alan / dinleyen yolcu sayısı
  const [radioAudio, setRadioAudio] = useState({ receiving: 0, listening: 0 });
  // YAPILACAKLAR3 #49: şoför tarafı yayın sağlığı (sinyal sunucusu + ağ durumu)
  const [signalOk, setSignalOk] = useState(true);
  const [netOnline, setNetOnline] = useState(true);
  const [signalRetry, setSignalRetry] = useState(0);
  const signalRetryRef = useRef(0);
  // YAPILACAKLAR3 #69: "yayın açık kalmalı" niyeti. Şoför sürüş sırasında
  // bağlantıyı düşünemez; yalnızca "Durdur"a basınca kapanır, diğer tüm
  // kopmalarda (peer hatası, ağ, sekme/uygulama değişimi, sayfa yenileme)
  // yayın kendi kendine geri gelir.
  const wantLiveRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const restartAttemptRef = useRef(0);
  const [recovering, setRecovering] = useState(false);

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
  // 17. madde: rota kırpma artık throttle'lı ve son indeksten devam ediyor
  const activeRoutePath = useTrimmedRoutePath(routePath, busPos);
  // D bölümü (#32/#36/#37): yol mesafesi + sıradaki durak + geçilince kilit sıfırlama
  const passedRef = useRef<Set<string>>(new Set());
  passedRef.current = passedIds;
  const routePathRef = useRef<[number, number][] | null>(null);
  routePathRef.current = routePath;
  const trendRef = useRef(initialTrendState());
  useEffect(() => {
    // #36: anons kilidi mesafeye değil "durak geçildi" olayına bağlı
    passedIds.forEach((id) => resetAnnounce(announceStateRef.current, id));
  }, [passedIds]);

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
  // #41: yolculara tam DayLog yerine delta gönderilir; #43: disk yazımı toplanır.
  const sentDayRef = useRef<DayLog | null>(null);
  const applyDay = (fn: (d: DayLog) => DayLog) => {
    const cur = dayRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    dayRef.current = next;
    setDay(next);
    saveDayBatched(next);
    const delta = diffDay(sentDayRef.current, next);
    const payload: JourneyPayload | JourneyDeltaPayload = delta ?? {
      type: "journey",
      day: next,
      ts: Date.now(),
    };
    if (delta === null && sentDayRef.current === next) return;
    sentDayRef.current = next;
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
    // #43: sekme gizlenince / kapanınca bekleyen kayıt anında diske yazılır
    const flush = () => void flushDay();
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      flush();
    };
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

  const handleGpsPosition = (pos: GeolocationPosition) => {
    lastFixTsRef.current = Date.now();
    gpsRetryRef.current = 0;
    setPosition(pos);
    setGpsWarn(null);
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
    setLiveHeading(pos.coords.heading);
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
    const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    stopsRef.current
      .filter((s) => s.kind === "stop")
      .forEach((s) => {
        const dm = distanceM(here, { lat: s.lat, lng: s.lng });
        if (dm <= ARRIVAL_RADIUS_M) applyDay((d) => recordArrival(d, s.id, s.name, now));
        // 1. ve 9. duraktan kalkışta karşılama anonsu (radyodan yayına girer)
        const greet = ingestDepartureGreeting(greetingRef.current, {
          stopId: s.id,
          stopName: s.name,
          distanceM: dm,
          speedKmh: res.speedKmh,
          accuracyM: pos.coords.accuracy,
          now,
        });
        if (greet) setLastAutoAnnounce({ label: greet, ts: Date.now() });
      });

    // 10.1 + D bölümü: anons yalnızca SIRADAKİ durak için, güzergâh (yol)
    // mesafesine ve hıza göre dinamik eşikle, yaklaşma yönü doğrulanarak yapılır.
    const target = pickNextStop(stopsRef.current, passedRef.current);
    if (target) {
      const tgt = { lat: target.lat, lng: target.lng };
      const dm = effectiveDistanceM(routePathRef.current, here, tgt);
      const avgKmh = avgSpeedKmh(statsRef.current);
      const approaching =
        ingestTrend(trendRef.current, target.id, dm) &&
        headingAgrees(pos.coords.heading, here, tgt, res.speedKmh);
      const thresholdM = announceDistanceM(res.speedKmh, avgKmh);
      const etaS = etaSeconds(dm, res.speedKmh, avgKmh);
      if (approaching && ingestStopDistance(announceStateRef.current, target.id, dm, thresholdM)) {
        const payload: StopAnnouncePayload = {
          type: "announce",
          stopId: target.id,
          stopName: target.name,
          distanceM: Math.round(dm),
          etaS: Math.round(etaS),
          ts: Date.now(),
        };
        setLastAnnounce(payload);
        broadcastEvent(payload);
      }
      // Konuma göre otomatik radyo anonsu (düğmeye basmaya gerek yok)
      const autoLabel = ingestAutoAnnounce(autoAnnounceRef.current, {
        stopId: target.id,
        stopName: target.name,
        distanceM: dm,
        etaS: isFinite(etaS) ? etaS : null,
        approaching,
      });
      if (autoLabel) setLastAutoAnnounce({ label: autoLabel, ts: Date.now() });
    }

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

    setCalibrating(res.calibrating);
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
      accuracyM: pos.coords.accuracy,
      calibrating: res.calibrating,
      // YAPILACAKLAR3 #1/#2: fix zamanı ve veri yaşı yolcuya gider
      fixTs: now,
      ageMs: 0,
      ts: Date.now(),
    };
    watchLastRef.current = payload;
    setFixAgeMs(0);
    broadcastPosition(payload);
  };

  /** YAPILACAKLAR3 #1: son konum paketini (yaş bilgisiyle) tüm yolculara gönderir. */
  const broadcastPosition = (payload: PositionPayload) => {
    connectionsRef.current.forEach((c) => {
      try {
        if (c.open) c.send(payload);
      } catch {
        /* ignore */
      }
    });
  };

  const handleGpsError = (err: GeolocationPositionError) => {
    // Bulgu 13: izin / sinyal / zaman aşımı ayrımı ve net kullanıcı mesajı
    if (err.code === err.PERMISSION_DENIED) {
      setGpsWarn(
        "Konum izni reddedildi. Tarayıcı ayarlarından bu site için konumu 'İzin ver' yapın.",
      );
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      setGpsWarn("GPS sinyali alınamıyor. Telefonu cam kenarına alın, konum servisini açın.");
    } else if (err.code === err.TIMEOUT) {
      setGpsWarn("GPS gecikti, yeniden deneniyor…");
    } else {
      setGpsWarn(`Konum alınamadı: ${err.message}`);
    }
  };

  // YAPILACAKLAR3 #5/#10: watchPosition'ı yeniden kurabilmek için tek giriş noktası
  const startGpsWatch = (lowAccuracy = false) => {
    if (watchIdRef.current !== null) {
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch {
        /* ignore */
      }
    }
    lowAccuracyRef.current = lowAccuracy;
    lastFixTsRef.current = Date.now();
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleGpsPosition,
      handleGpsError,
      lowAccuracy
        ? { enableHighAccuracy: false, maximumAge: 5000, timeout: 30000 }
        : { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  };

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

    // #69: yayın niyeti kaydedilir; sayfa yenilense/çökse bile geri döner.
    wantLiveRef.current = true;
    try {
      localStorage.setItem(LIVE_WANT_KEY, "1");
    } catch {
      /* ignore */
    }
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    // Eski örnek varsa temizle (çift Peer kimliği çakışmasın)
    if (peerRef.current && !peerRef.current.destroyed) {
      try {
        peerRef.current.destroy();
      } catch {
        /* ignore */
      }
    }
    const peer = new Peer(DRIVER_PEER_ID, { ...PEER_OPTIONS });
    peerRef.current = peer;

    peer.on("open", () => {
      idRetryRef.current = 0;
      restartAttemptRef.current = 0;
      setRecovering(false);
      setError(null);
      setPeerReady(true);
      setSignalOk(true);
      setSignalRetry(0);
      setRunning(true);
      runningRef.current = true;
      applyDay((d) => openSession(d));
    });

    // YAPILACAKLAR3 #49: sinyal (signaling) sunucusuyla bağlantı koparsa yayın
    // kimliği düşer ve yeni yolcu bağlanamaz. Kademeli olarak kendini toparlar.
    peer.on("disconnected", () => {
      setSignalOk(false);
      if (!runningRef.current || peer.destroyed) return;
      const attempt = signalRetryRef.current++;
      setSignalRetry(attempt + 1);
      window.setTimeout(() => {
        if (!runningRef.current || peer.destroyed || !peer.disconnected) return;
        try {
          peer.reconnect();
        } catch {
          /* bir sonraki denemede tekrar */
        }
      }, reconnectDelay(attempt));
    });

    peer.on("connection", (conn) => {
      connectionsRef.current.add(conn);
      setConnCount(connectionsRef.current.size);
      lastPongRef.current.set(conn.peer, Date.now());
      // #17: bağlantıyı temizleyen tek giriş noktası
      const dropConn = () => {
        iceStopRef.current.get(conn.peer)?.();
        iceStopRef.current.delete(conn.peer);
        lastPongRef.current.delete(conn.peer);
        forgetPeer(conn.peer);
        connectionsRef.current.delete(conn);
        setConnCount(connectionsRef.current.size);
        setRiders((prev) => prev.filter((r) => r.peerId !== conn.peer));
        try {
          conn.close();
        } catch {
          /* ignore */
        }
      };
      conn.on("open", () => {
        lastPongRef.current.set(conn.peer, Date.now());
        // #16: ICE kopar/başarısız olursa önce ICE restart, olmazsa bağlantıyı düş
        iceStopRef.current.get(conn.peer)?.();
        iceStopRef.current.set(
          conn.peer,
          watchIceState(conn, () => {
            if (!tryIceRestart(conn)) dropConn();
          }),
        );
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
            // Yeni bağlanan yolcu tam anlık görüntü alır; sonrası delta.
            conn.send({ type: "journey", day: dayRef.current, ts: Date.now() } as JourneyPayload);
            sentDayRef.current = dayRef.current;
          } catch {
            /* ignore */
          }
        }
        // Radyo durumunu her zaman gönder: #28 (yenilenmiş şoför sekmesinde parça
        // listesi kaybolduysa yolcu "canlı" görünmeye devam etmesin).
        try {
          conn.send(
            lastRadioRef.current
              ? { ...lastRadioRef.current, ts: Date.now() }
              : ({
                  type: "radio",
                  playing: false,
                  title: null,
                  index: 0,
                  total: 0,
                  ts: Date.now(),
                } as RadioStatePayload),
          );
        } catch {
          /* ignore */
        }
        // #23: yayın açıksa sonradan giren yolcuya hemen ses akışı gönder
        if (radioStreamRef.current && peerRef.current) {
          callPeer(peerRef.current, conn.peer, radioStreamRef.current);
        }
      });
      conn.on("data", (data) => {
        // #17: yolcunun pong'u → bağlantı canlı sayılır
        if ((data as PongPayload)?.type === "pong") {
          lastPongRef.current.set(conn.peer, Date.now());
          return;
        }
        // Yolcu hangi duraktan takip ediyor?
        if ((data as PresencePayload)?.type === "presence") {
          const pr = data as PresencePayload;
          lastPongRef.current.set(conn.peer, Date.now());
          setRiders((prev) => [
            ...prev.filter((r) => r.peerId !== conn.peer),
            { peerId: conn.peer, stopId: pr.stopId, stopName: pr.stopName, ts: Date.now() },
          ]);
          return;
        }
        // #27: yolcu radyo sesini alıyor mu?
        if ((data as RadioAckPayload)?.type === "audio-ok") {
          const ack = data as RadioAckPayload;
          lastPongRef.current.set(conn.peer, Date.now());
          markAudioOk(conn.peer, Boolean(ack.listening));
          return;
        }
        // #24: yolcuya ses gelmediyse çağrıyı yeniden kur
        if ((data as RadioRequestPayload)?.type === "radio-req") {
          lastPongRef.current.set(conn.peer, Date.now());
          const stream = radioStreamRef.current;
          if (stream && peerRef.current) callPeer(peerRef.current, conn.peer, stream);
          return;
        }
        // Durak tahmini oyunu: puanı sıralamaya işle ve tüm yolculara dağıt
        if ((data as GuessScorePayload)?.type === "guess-score") {
          const g = data as GuessScorePayload;
          lastPongRef.current.set(conn.peer, Date.now());
          const rows = mergeBoard(
            guessBoardRef.current,
            {
              name: (g.name || "Yolcu").slice(0, 16),
              points: Number(g.points) || 0,
              games: 1,
              ts: Date.now(),
            },
            g.name || "Yolcu",
          );
          guessBoardRef.current = rows;
          const payload: GuessBoardPayload = { type: "guess-board", rows, ts: Date.now() };
          connectionsRef.current.forEach((c) => {
            try {
              if (c.open) c.send(payload);
            } catch {
              /* ignore */
            }
          });
          return;
        }
        // Yolcunun gönderdiği müzik parçaları (istek şarkısı)
        if (ingestSongPacket(conn.peer, data)) {
          lastPongRef.current.set(conn.peer, Date.now());
          return;
        }
        const p = data as VoiceAlertPayload;
        if (p?.type !== "alert") return;
        setAlerts((prev) => [p, ...prev].slice(0, 20));
        // Uyarı sekmesi açık değilse okunmamış sayacı artar (rozet)
        if (tabRef.current !== 3) setUnreadAlerts((n) => Math.min(n + 1, 99));
        setAlertToast(p);
        if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setAlertToast(null), 7000);
        beep();
        // Telsiz hissi: kısa hışırtı → mesaj → kapanış cızırtısı
        squelchOpen();
        window.setTimeout(() => {
          if (p.kind === "voice" && p.audio) {
            void playBase64Audio(p.audio, p.mime ?? "audio/webm");
          } else {
            speak(p.text ?? `${p.stopName ?? "Bir"} durağındaki yolcu bugün gelmiyor.`);
          }
          window.setTimeout(() => squelchClose(), 900);
        }, 350);
      });

      conn.on("close", dropConn);
      conn.on("error", dropConn);
    });

    peer.on("error", (err) => {
      if (String(err?.type) === "unavailable-id") {
        // Eski oturum sunucuda hâlâ kayıtlı olabilir (sekme kapansa da ~1-2 dk sürer).
        // Kısa aralıklarla yeniden dene, kullanıcıyı bekletmeden devral.
        stopInternal();
        if (idRetryRef.current < 8) {
          idRetryRef.current += 1;
          setError(
            `Önceki yayın oturumu kapanıyor, kimlik devralınıyor… (${idRetryRef.current}/8)`,
          );
          window.setTimeout(() => startRef.current(), reconnectDelay(idRetryRef.current - 1));
        } else {
          idRetryRef.current = 0;
          setError(
            "Bu servis şu an başka bir cihazdan yayınlanıyor. Diğer cihazdaki yayını durdurup tekrar deneyin.",
          );
          // #69: yine de nöbetçi arka planda denemeye devam eder.
          scheduleRestartRef.current();
        }
        return;
      }
      // #69: eskiden burada yayın tamamen duruyordu. Artık kopma kalıcı değil:
      // yayın kapatılır, otomatik olarak yeniden kurulur.
      setError(`Bağlantı koptu (${err.message}) · otomatik yeniden bağlanılıyor…`);
      stopInternal();
      scheduleRestartRef.current();
    });

    // Konum takibi (watchdog + kalp atışı efektleri aşağıda)
    startGpsWatch(false);
  };

  const watchLastRef = useRef<PositionPayload | null>(null);

  // YAPILACAKLAR3 #1 & #5: kalp atışı (1 sn) + fix watchdog'u.
  // Sinyal kesilse bile yolcuya "son paket + yaşı" gider; 15 sn fix yoksa
  // watchPosition yeniden kurulur, 3 denemede düşük hassasiyete düşülür.
  useEffect(() => {
    if (!running) {
      setFixAgeMs(null);
      return;
    }
    const id = window.setInterval(() => {
      const last = watchLastRef.current;
      const now = Date.now();
      if (last) {
        const ageMs = now - last.fixTs;
        setFixAgeMs(ageMs);
        // #20/#42: araç duruyorsa yayın periyodu kademeli seyreltilir.
        // 0-15 sn duruş: 3 sn · 15 sn+ duruş: 6 sn · 60 sn+ duruş: 10 sn
        const stationary = last.speedKmh < 2;
        if (!stationary) stoppedSinceRef.current = 0;
        else if (stoppedSinceRef.current === 0) stoppedSinceRef.current = now;
        const stoppedMs = stationary ? now - stoppedSinceRef.current : 0;
        const period = !stationary
          ? 1000
          : stoppedMs > 60000
            ? 10000
            : stoppedMs > 15000
              ? 6000
              : 3000;
        if (now - lastBroadcastRef.current >= period - 100) {
          lastBroadcastRef.current = now;
          broadcastPosition({ ...last, ageMs, ts: now });
        }
      }
      const sinceFix = now - lastFixTsRef.current;
      if (lastFixTsRef.current > 0 && sinceFix > 15000) {
        gpsRetryRef.current += 1;
        const goLow = gpsRetryRef.current >= 3;
        setGpsWarn(
          goLow
            ? "GPS yanıt vermiyor — düşük hassasiyet moduna geçildi."
            : `GPS ${Math.round(sinceFix / 1000)} sn'dir veri göndermiyor, takip yeniden kuruluyor…`,
        );
        startGpsWatch(goLow || lowAccuracyRef.current);
      }
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // YAPILACAKLAR3 #17: ping/pong ile ölü bağlantı temizliği.
  // Yolcu sayacı böylece gerçek dinleyici sayısını gösterir.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      const ping: PingPayload = { type: "ping", ts: now };
      connectionsRef.current.forEach((c) => {
        const last = lastPongRef.current.get(c.peer) ?? now;
        if (!c.open || now - last > PONG_TIMEOUT_MS) {
          iceStopRef.current.get(c.peer)?.();
          iceStopRef.current.delete(c.peer);
          lastPongRef.current.delete(c.peer);
          connectionsRef.current.delete(c);
          try {
            c.close();
          } catch {
            /* ignore */
          }
          return;
        }
        try {
          c.send(ping);
        } catch {
          /* ignore */
        }
      });
      setConnCount(connectionsRef.current.size);
    }, PING_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [running]);

  // YAPILACAKLAR3 #65: yolcu bağlantılarının kalitesi (en kötü gecikme + röle sayısı)
  useEffect(() => {
    if (!running) {
      setLinkQuality({ rttMs: null, relay: 0 });
      return;
    }
    let alive = true;
    const read = async () => {
      const list = Array.from(connectionsRef.current);
      const results = await Promise.all(list.map((c) => readConnectionQuality(c)));
      if (!alive) return;
      const rtts = results.map((r) => r.rttMs).filter((v): v is number => v != null);
      setLinkQuality({
        rttMs: rtts.length ? Math.max(...rtts) : null,
        relay: results.filter((r) => r.transport === "relay").length,
      });
    };
    read();
    const id = window.setInterval(read, 5000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [running]);

  // YAPILACAKLAR3 #23/#24/#27: radyo çağrı bekçisi.
  // Yayın açıkken tüm açık bağlantılarda ses akışının kurulduğunu doğrular,
  // onay gelmeyen (sessiz kalan) yolcuya çağrıyı yeniler.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      const peer = peerRef.current;
      if (!peer) return;
      const peers = Array.from(connectionsRef.current)
        .filter((c) => c.open)
        .map((c) => c.peer);
      reconcileCalls(peer, peers, radioStreamRef.current);
      setRadioAudio(audioStats());
    }, 2000);
    return () => window.clearInterval(id);
  }, [running]);

  // YAPILACAKLAR3 #18: TURN (röle) erişilebilirlik testi.
  // Yayın açılışında TURN'ü meşgul edip bağlanmayı yavaşlatmaması için
  // ilk bağlantı kurulduktan ~12 sn sonra çalışır.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    setRelayStatus("checking");
    const t = window.setTimeout(() => {
      void checkTurnReachable().then((ok) => {
        if (!cancelled) setRelayStatus(ok ? "ok" : "unavailable");
      });
    }, 12000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [running]);

  const stopInternal = () => {
    runningRef.current = false;
    applyDay((d) => closeSession(d));
    void flushDay(); // #43: sefer bitişinde bekleyen kayıt anında diske yazılır

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    connectionsRef.current.forEach((c) => c.close());
    connectionsRef.current.clear();
    iceStopRef.current.forEach((stop) => stop());
    iceStopRef.current.clear();
    lastPongRef.current.clear();
    clearCalls();
    setRadioAudio({ receiving: 0, listening: 0 });
    setRelayStatus("unknown");
    peerRef.current?.destroy();
    peerRef.current = null;
    setConnCount(0);
    setPeerReady(false);
    setRunning(false);
    setPosition(null);
    filterRef.current = initialFilterState();
    setLiveSpeed(0);
  };

  /**
   * #69: yayını kalıcı olarak durdurma — YALNIZCA şoför "Durdur"a basınca.
   * Niyet silinir, nöbetçi bir daha başlatmaz.
   */
  const stopBroadcast = () => {
    wantLiveRef.current = false;
    try {
      localStorage.removeItem(LIVE_WANT_KEY);
    } catch {
      /* ignore */
    }
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    restartAttemptRef.current = 0;
    setRecovering(false);
    stopInternal();
  };

  /** #69: kopma sonrası kademeli otomatik yeniden başlatma (2s → 30s). */
  const scheduleRestart = (immediate = false) => {
    if (!wantLiveRef.current) return;
    if (restartTimerRef.current) return;
    if (runningRef.current) return;
    const attempt = restartAttemptRef.current++;
    setRecovering(true);
    setSignalOk(false);
    setSignalRetry(attempt + 1);
    const delay = immediate ? 300 : reconnectDelay(attempt);
    restartTimerRef.current = window.setTimeout(() => {
      restartTimerRef.current = null;
      if (!wantLiveRef.current || runningRef.current) return;
      startRef.current();
    }, delay);
  };

  const scheduleRestartRef = useRef<(immediate?: boolean) => void>(() => undefined);
  scheduleRestartRef.current = scheduleRestart;

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

  // Bulgu 1 & 2: yayın açıkken ekranın kapanmasını engelle (GPS + yayın kesilmesin),
  // sekme arka plandan dönünce kilidi yeniden al.
  useEffect(() => {
    if (!running) {
      void releaseScreenAwake();
      setAwake(false);
      return;
    }
    let cancelled = false;
    void keepScreenAwake().then((ok) => {
      if (!cancelled) setAwake(ok);
    });
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      void keepScreenAwake().then((ok) => {
        if (!cancelled) setAwake(ok);
      });
      // Arka plandan dönüşte bağlantı kopmuşsa yayını toparla
      const p = peerRef.current;
      if (p && p.disconnected && !p.destroyed) {
        try {
          p.reconnect();
        } catch {
          /* ignore */
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      void releaseScreenAwake();
      setAwake(false);
    };
  }, [running]);

  // YAPILACAKLAR3 #49 + #69: yayın nöbetçisi.
  // Ağ döndüğünde, sinyal sessizce düştüğünde veya Peer tamamen öldüğünde
  // yayın kendini toparlar. Şoförün hiçbir şeye dokunması gerekmez.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setNetOnline(navigator.onLine);
    const kick = (immediate = false) => {
      const p = peerRef.current;
      if (!wantLiveRef.current) return;
      // Peer tamamen öldüyse (ya da hiç yoksa) baştan kur
      if (!p || p.destroyed || !runningRef.current) {
        scheduleRestartRef.current(immediate);
        return;
      }
      if (p.disconnected) {
        try {
          p.reconnect();
        } catch {
          /* nöbetçi tekrar deneyecek */
        }
      }
    };
    const onOnline = () => {
      setNetOnline(true);
      kick(true);
    };
    const onOffline = () => setNetOnline(false);
    // Telefon uykudan kalkınca / uygulamalar arası dönüşte anında kontrol
    const onVisible = () => {
      if (document.visibilityState === "visible") kick(true);
    };
    const onPageShow = () => kick(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (!wantLiveRef.current) return;
      const p = peerRef.current;
      if (!p || p.destroyed || !runningRef.current) {
        setSignalOk(false);
        kick();
        return;
      }
      const ok = !p.disconnected;
      setSignalOk(ok);
      if (ok) {
        signalRetryRef.current = 0;
        restartAttemptRef.current = 0;
        setRecovering(false);
      } else kick();
    }, 5000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onPageShow);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  // #69: sayfa yenilenirse / uygulama çökerse yayın niyeti hatırlanır ve
  // panel açılır açılmaz yayın kendiliğinden geri gelir.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let want = false;
    try {
      want = localStorage.getItem(LIVE_WANT_KEY) === "1";
    } catch {
      /* ignore */
    }
    if (!want) return;
    wantLiveRef.current = true;
    const t = window.setTimeout(() => {
      if (!runningRef.current) startRef.current();
    }, 400);
    return () => window.clearTimeout(t);
  }, []);

  // Sayfa gerçekten kapanırken yayın kimliğini sunucuda serbest bırak.
  // (bfcache'e giren "pagehide" sayılmaz: geri dönüşte yayın devam etmeli.)
  useEffect(() => {
    const release = (e?: PageTransitionEvent) => {
      if (e && "persisted" in e && e.persisted) return;
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
    const onPageHide = (e: Event) => release(e as PageTransitionEvent);
    const onUnload = () => release();
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  const speedKmh = liveSpeed;

  const onTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    swipeBlockedRef.current = Boolean(
      target.closest("button, input, select, textarea, label, [role='slider'], .maplibregl-map"),
    );
    const touch = event.touches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const onTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const startPoint = touchStartRef.current;
    touchStartRef.current = null;
    if (!startPoint || swipeBlockedRef.current) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - startPoint.x;
    const deltaY = touch.clientY - startPoint.y;
    if (Math.abs(deltaX) < 55 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;
    setTab((current) =>
      deltaX < 0 ? Math.min(current + 1, DRIVER_TABS.length - 1) : Math.max(current - 1, 0),
    );
  };

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

      <main
        className={`flex-1 max-w-5xl w-full mx-auto p-4 flex flex-col gap-4 ${running ? "pb-28" : ""}`}
        onTouchStart={running ? onTouchStart : undefined}
        onTouchEnd={running ? onTouchEnd : undefined}
      >
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
              <div
                className={`w-3 h-3 rounded-full ${signalOk && netOnline ? "bg-primary animate-pulse" : "bg-red-500"}`}
              />
              <div className="flex-1">
                <div className="hud-label">Durum</div>
                <div className="font-bold">
                  {!netOnline
                    ? "İNTERNET YOK · ağ gelince otomatik bağlanacak"
                    : recovering
                      ? `BAĞLANTI KOPTU · otomatik yeniden kuruluyor (${signalRetry})`
                      : !signalOk
                        ? `SİNYAL KOPTU · yeniden bağlanılıyor (${signalRetry})`
                        : `YAYINDA · ${SERVICE_INFO.plate}`}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Yayın otomatik korunur; kapatmak için "Durdur".
                </div>
              </div>
              <div className="text-right">
                <div className="hud-label">Yolcu</div>
                <div className="text-2xl font-mono font-bold text-primary">{connCount}</div>
              </div>
              <button
                onClick={stopBroadcast}
                className="bg-destructive text-destructive-foreground px-4 py-2 rounded-md font-semibold hover:bg-destructive/90"
              >
                Durdur
              </button>
            </div>

            <div className="flex items-center justify-between mt-1">
              <div className="hud-label">{DRIVER_TABS[tab]?.label}</div>
              <div className="flex items-center gap-1.5" aria-hidden="true">
                {DRIVER_TABS.map((item, index) => (
                  <span
                    key={item.id}
                    className={`h-1.5 rounded-full transition-all ${
                      index === tab ? "w-5 bg-primary" : "w-1.5 bg-border"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* SERVİSTE: hangi durakta kaç yolcu takip ediyor */}
            <div className={tab === 0 ? "panel p-4 animate-in fade-in duration-200" : "hidden"}>
              <div className="flex items-center justify-between mb-2">
                <div className="hud-label">Serviste · takip eden duraklar</div>
                <div className="text-xs font-mono text-muted-foreground">{riders.length} yolcu</div>
              </div>
              {riderGroups.length === 0 ? (
                <div className="text-xs text-muted-foreground">Henüz takip eden yolcu yok.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {riderGroups.map((g) => (
                    <div
                      key={g.stopId}
                      className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5"
                    >
                      <span className="text-sm font-semibold">{g.stopName}</span>
                      <span className="text-xs font-mono text-primary">×{g.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* YAPILACAKLAR3 #49: yayın sağlığı – tek bakışta her şey */}
            <div
              className={
                tab === 4
                  ? "panel px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-mono animate-in fade-in duration-200"
                  : "hidden"
              }
            >
              <HealthItem
                label="GPS"
                value={position ? `±${Math.round(position.coords.accuracy)} m` : "yok"}
                ok={Boolean(position) && (position?.coords.accuracy ?? 999) <= 35}
                warn={Boolean(position) && (position?.coords.accuracy ?? 999) <= 90}
              />
              <HealthItem
                label="Fix yaşı"
                value={fixAgeMs == null ? "—" : `${Math.round(fixAgeMs / 1000)} sn`}
                ok={fixAgeMs != null && fixAgeMs < 5000}
                warn={fixAgeMs != null && fixAgeMs < 15000}
              />
              <HealthItem
                label="Sinyal"
                value={!netOnline ? "internet yok" : signalOk ? "bağlı" : `yeniden ${signalRetry}`}
                ok={netOnline && signalOk}
              />
              <HealthItem label="Yolcu" value={`${connCount}`} ok={connCount > 0} warn />
              <HealthItem
                label="Röle"
                value={
                  relayStatus === "ok"
                    ? "hazır"
                    : relayStatus === "checking"
                      ? "kontrol…"
                      : relayStatus === "unavailable"
                        ? "yok"
                        : "—"
                }
                ok={relayStatus === "ok"}
                warn={relayStatus === "checking" || relayStatus === "unknown"}
              />
              {/* #65: yolcu bağlantılarının gecikmesi ve röle kullanımı */}
              <HealthItem
                label="Gecikme"
                value={
                  connCount === 0
                    ? "—"
                    : `${linkQuality.rttMs == null ? "ölçülüyor" : `${linkQuality.rttMs} ms`}${
                        linkQuality.relay > 0 ? ` · ${linkQuality.relay} röle` : " · doğrudan"
                      }`
                }
                ok={linkQuality.rttMs != null && linkQuality.rttMs < 200}
                warn={linkQuality.rttMs == null || linkQuality.rttMs < 500}
              />
              <HealthItem
                label="Radyo"
                value={`${radioAudio.listening}/${radioAudio.receiving} dinliyor`}
                ok={radioAudio.listening > 0}
                warn
              />
              <HealthItem
                label="Ekran"
                value={awake ? "açık tutuluyor" : "kilitlenebilir"}
                ok={awake}
                warn
              />
            </div>

            <div className={tab === 0 ? "panel p-5 animate-in fade-in duration-200" : "hidden"}>
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

            <div
              className={
                tab === 1 ? "grid grid-cols-2 gap-4 animate-in fade-in duration-200" : "hidden"
              }
            >
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

            <div className={tab === 1 ? "block animate-in fade-in duration-200" : "hidden"}>
              <WeatherCard
                position={
                  position
                    ? { lat: position.coords.latitude, lng: position.coords.longitude }
                    : null
                }
              />
            </div>

            <div className={tab === 1 ? "panel p-5 animate-in fade-in duration-200" : "hidden"}>
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
            <div className={tab === 3 ? "panel p-5 animate-in fade-in duration-200" : "hidden"}>
              <div className="flex items-center justify-between mb-3">
                <div className="hud-label">Durak Anonsu & Ani Fren</div>
                <span className="text-[11px] font-mono text-muted-foreground">
                  {motionReady ? "İVMEÖLÇER AKTİF" : "GPS YEDEĞİ"}
                </span>
              </div>

              <p className="text-sm text-muted-foreground">
                Durak ETA sesleri yalnızca ilgili durağı seçen yolcunun telefonunda çalar.
              </p>

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

              <div className="mt-3 rounded-md border border-border p-3">
                <div className="hud-label mb-1">Son Otomatik Radyo Anonsu</div>
                <div className="font-bold truncate">
                  {lastAutoAnnounce ? lastAutoAnnounce.label : "—"}
                </div>
                <div className="text-[11px] font-mono text-muted-foreground mt-1">
                  {lastAutoAnnounce
                    ? new Date(lastAutoAnnounce.ts).toLocaleTimeString("tr-TR")
                    : "25 Saat Fırın 2 dk + 30 sn · Eloktroland 30 sn"}
                </div>
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

            {/* Radyo sekme değişiminde kaldırılmaz; yayın ve istek sırası kesilmez. */}
            <div className={tab === 2 ? "block animate-in fade-in duration-200" : "hidden"}>
              <Suspense fallback={null}>
                <DriverRadio
                  peerRef={peerRef}
                  connectionsRef={connectionsRef}
                  radioStreamRef={radioStreamRef}
                  broadcast={broadcastRadio}
                  listeningCount={radioAudio.listening}
                  receivingCount={radioAudio.receiving}
                />
              </Suspense>
            </div>

            <div className={tab === 3 ? "panel p-5 animate-in fade-in duration-200" : "hidden"}>
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

            {/* Harita sekme değişiminde kaldırılmaz; yalnızca gizlenir (yeniden yüklenme yok). */}
            <div
              className={
                tab === 4
                  ? "panel overflow-hidden h-[70vh] min-h-[420px] animate-in fade-in duration-200"
                  : "hidden"
              }
            >
              <Suspense fallback={null}>
                <MapView
                  stops={activeStops}
                  busPosition={busPos}
                  routePath={activeRoutePath}
                  busHeading={liveHeading}
                  busSpeedKmh={liveSpeed}
                  busIconUrl={busDriverIcon}
                  className="h-full min-h-[400px]"
                />
              </Suspense>
            </div>

            <div
              className={
                tab === 4
                  ? "panel px-4 py-3 flex items-center gap-3 text-sm animate-in fade-in duration-200"
                  : "hidden"
              }
            >
              <div
                className={`w-2.5 h-2.5 rounded-full ${peerReady ? "bg-primary animate-pulse" : "bg-yellow-500 animate-pulse"}`}
              />
              <span className="font-semibold uppercase tracking-wider">
                {peerReady ? `Yayın açık · ${connCount} yolcu` : "Bağlanıyor"}
              </span>
              <span className="ml-auto hud-label">
                {awake
                  ? "Ekran açık tutuluyor"
                  : isWakeLockSupported()
                    ? "Ekran kilidi alınamadı"
                    : "Ekran kilidi desteklenmiyor"}
              </span>
            </div>

            {(() => {
              const acc = accuracyLabel(position?.coords.accuracy);
              return (
                <div
                  className={
                    tab === 4
                      ? "panel px-4 py-3 flex items-center gap-3 text-sm animate-in fade-in duration-200"
                      : "hidden"
                  }
                >
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${acc.level === "iyi" ? "bg-primary" : acc.level === "zayıf" ? "bg-yellow-500" : "bg-red-500"}`}
                  />
                  <span className="font-mono">{acc.text}</span>
                  {running && fixAgeMs != null && (
                    <span
                      className={`font-mono text-xs ${fixAgeMs > 10000 ? "text-yellow-500" : "text-muted-foreground"}`}
                    >
                      fix {Math.round(fixAgeMs / 1000)} sn
                    </span>
                  )}
                  {calibrating && (
                    <span className="font-mono text-xs text-yellow-500">kalibre ediliyor…</span>
                  )}
                  {gpsWarn && <span className="ml-auto text-right text-red-400">{gpsWarn}</span>}
                </div>
              );
            })()}

            {!peerReady && tab === 4 && (
              <div className="text-center text-sm text-muted-foreground">
                PeerJS sunucusuna bağlanılıyor...
              </div>
            )}
          </>
        )}
      </main>

      {running && alertToast && (
        <button
          type="button"
          onClick={() => {
            setTab(3);
            setAlertToast(null);
          }}
          className="fixed inset-x-2 bottom-[76px] z-50 flex items-center gap-3 rounded-lg border border-primary/60 bg-card/95 px-4 py-3 text-left shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2"
        >
          <span className="text-xl" aria-hidden="true">
            {alertToast.kind === "voice" ? "🎙" : "🙅"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {alertToast.stopName ?? "Bilinmeyen durak"}
            </span>
            <span className="block text-[11px] font-mono text-muted-foreground">
              {alertToast.kind === "voice" ? "SESLİ MESAJ" : "GELMİYOR"} · dokun ve gör
            </span>
          </span>
        </button>
      )}

      {running && (
        <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="max-w-5xl mx-auto grid grid-cols-5">
            {DRIVER_TABS.map((item, index) => {
              const active = index === tab;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(index)}
                  aria-current={active ? "page" : undefined}
                  aria-label={
                    item.id === "uyari" && unreadAlerts > 0
                      ? `${item.label} sekmesi, ${unreadAlerts} yeni uyarı`
                      : `${item.label} sekmesi`
                  }
                  className={`relative flex min-w-0 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold uppercase transition ${
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="text-lg leading-none" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="w-full truncate px-1">{item.label}</span>
                  {item.id === "radyo" && radioStreamRef.current && (
                    <span className="absolute top-1.5 right-1/2 translate-x-4 live-dot" />
                  )}
                  {item.id === "uyari" && unreadAlerts > 0 && (
                    <span className="absolute top-1 right-1/2 translate-x-5 min-w-[18px] rounded-full bg-destructive px-1 text-[10px] font-bold leading-[18px] text-destructive-foreground">
                      {unreadAlerts}
                    </span>
                  )}
                  {active && (
                    <span className="absolute top-0 inset-x-3 h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="h-[env(safe-area-inset-bottom)]" />
        </nav>
      )}
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

/** YAPILACAKLAR3 #49: yayın sağlığı satırındaki tek gösterge. */
function HealthItem({
  label,
  value,
  ok,
  warn = false,
}: {
  label: string;
  value: string;
  ok: boolean;
  warn?: boolean;
}) {
  const color = ok ? "text-primary" : warn ? "text-amber-400" : "text-red-400";
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </span>
  );
}
