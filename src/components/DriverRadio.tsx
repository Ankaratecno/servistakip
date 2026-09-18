import { useEffect, useRef, useState } from "react";
import type Peer from "peerjs";
import type { DataConnection } from "peerjs";
import type { RadioStatePayload } from "@/lib/radio";
import { loadBuffer, playJingle } from "@/lib/jingle";
import {
  hourAnnouncementUrl,
  randomJingleUrl,
  requestAnnouncementUrl,
  stopAnnouncement,
  type StopAnnouncementKey,
} from "@/lib/voice-assets";
import {
  onRadioAnnouncement,
  queueRadioAnnouncement,
  type RadioAnnouncement,
} from "@/lib/radio-announce";
import { callPeer, ensureCall } from "@/lib/radio-calls";
import { setMediaHandlers, setNowPlaying, setPlaybackState } from "@/lib/media-session";
import {
  onSongRequest,
  riderLabel,
  type SongAckPayload,
  type SongRequest,
} from "@/lib/song-request";
import {
  clearProgress,
  deleteSong,
  listPlayedIds,
  listSongs,
  loadProgress,
  markPlayed,
  RESUME_REWIND_SEC,
  saveProgress,
  type SongProgress,
} from "@/lib/song-store";
import {
  clearTracks,
  deleteTrack,
  LIBRARY_REWIND_SEC,
  listTracks,
  loadLibraryState,
  reorderTracks,
  saveLibraryState,
  saveTracks,
  type LibraryState,
} from "@/lib/driver-library";

export function RequestDisplay({ title, rider }: { title: string | null; rider: string | null }) {
  const [showRider, setShowRider] = useState(false);
  useEffect(() => {
    if (!rider) {
      setShowRider(false);
      return;
    }
    setShowRider(false);
    const id = window.setInterval(() => setShowRider((s) => !s), 4000);
    return () => window.clearInterval(id);
  }, [rider]);

  return (
    <div className="font-bold text-lg tracking-wide truncate text-foreground">
      {showRider && rider ? `· ${rider}` : (title ?? "—")}
    </div>
  );
}

interface Track {
  id: string;
  name: string;
  url: string;
}

export default function DriverRadio({
  peerRef,
  connectionsRef,
  radioStreamRef,
  broadcast,
  listeningCount = 0,
  receivingCount = 0,
}: {
  peerRef: React.MutableRefObject<Peer | null>;
  connectionsRef: React.MutableRefObject<Set<DataConnection>>;
  radioStreamRef: React.MutableRefObject<MediaStream | null>;
  broadcast: (p: RadioStatePayload) => void;
  listeningCount?: number;
  receivingCount?: number;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [monitor, setMonitor] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [jingleOn, setJingleOn] = useState(true);
  const [jingleEvery, setJingleEvery] = useState(3);
  const [hourlyOn, setHourlyOn] = useState(true);
  const [onAir, setOnAir] = useState<string | null>(null);
  // Yolcu istek şarkıları (P2P ile gelen dosyalar)
  const [queue, setQueue] = useState<SongRequest[]>([]);
  const [nowRequest, setNowRequest] = useState<SongRequest | null>(null);
  const [autoRequests, setAutoRequests] = useState(true);
  /** Yarıda kalan isteğin kimliği (listede "kaldığı yerden" etiketi için). */
  const [resumeId, setResumeId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const monitorGainRef = useRef<GainNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;
  const indexRef = useRef(0);
  indexRef.current = index;
  const playedCountRef = useRef(0);
  const busyRef = useRef(false);
  const lastHourRef = useRef<number>(new Date().getHours());
  const jingleOnRef = useRef(true);
  jingleOnRef.current = jingleOn;
  const jingleEveryRef = useRef(3);
  jingleEveryRef.current = jingleEvery;
  const queueRef = useRef<SongRequest[]>([]);
  queueRef.current = queue;
  const nowRequestRef = useRef<SongRequest | null>(null);
  nowRequestRef.current = nowRequest;
  const autoRequestsRef = useRef(true);
  autoRequestsRef.current = autoRequests;
  /** Yarıda kalan istek parçasının kayıtlı anı (kopma sonrası devam). */
  const resumeRef = useRef<SongProgress | null>(null);
  /** Çalınıp bitmiş/atılmış istekler: aynı parça bir daha sıraya girmesin. */
  const playedRef = useRef<Set<string>>(new Set());
  /** Şoför listesinde yarıda kalan parçanın kayıtlı anı (kopma sonrası devam). */
  const libResumeRef = useRef<LibraryState | null>(null);
  /**
   * #5/#6: Ses "çalıyor olmalı" niyeti. Bağlantı kopması, sekme tazelenmesi ya
   * da tarayıcının otomatik duraklatması durumunda ses öğesi sıfırlanmadan
   * kaldığı yerden sürdürülür (Bluetooth çıkışı kesilmez).
   */
  const wantPlayRef = useRef(false);

  /**
   * Bir isteği tamamen tüketir: kalıcı işaret koyar, kaydı ve devam notunu
   * siler, sırada duruyorsa çıkarır. Böylece parça tekrar dönmez.
   */
  const consumeRequest = (req: SongRequest | { id: string; url?: string }) => {
    playedRef.current.add(req.id);
    void markPlayed(req.id);
    void deleteSong(req.id);
    if (req.url) {
      try {
        URL.revokeObjectURL(req.url);
      } catch {
        /* ignore */
      }
    }
    if (resumeRef.current?.id === req.id) {
      resumeRef.current = null;
      setResumeId(null);
      void clearProgress();
    }
    queueRef.current = queueRef.current.filter((r) => r.id !== req.id);
    setQueue((prev) => prev.filter((r) => r.id !== req.id));
  };
  const consumeRequestRef = useRef(consumeRequest);
  consumeRequestRef.current = consumeRequest;

  // Audio grafiği: <audio> -> gain -> (yayın hedefi + hoparlör)
  const ensureGraph = () => {
    if (!audioRef.current) {
      const el = new Audio();
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.addEventListener("ended", () => void afterTrackRef.current());
      audioRef.current = el;
    }
    if (!ctxRef.current) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(audioRef.current);
      const gain = ctx.createGain();
      const monitorGain = ctx.createGain();
      const dest = ctx.createMediaStreamDestination();
      src.connect(gain);
      gain.connect(dest);
      gain.connect(monitorGain);
      monitorGain.connect(ctx.destination);
      gain.gain.value = volume;
      monitorGain.gain.value = monitor ? 1 : 0;
      ctxRef.current = ctx;
      gainRef.current = gain;
      monitorGainRef.current = monitorGain;
      destRef.current = dest;
      radioStreamRef.current = dest.stream;
      // #23: yayın kaynağı yeni oluştu → mevcut tüm yolculara hemen çağrı at.
      window.setTimeout(() => callEveryone(true), 0);
    }
    void ctxRef.current.resume();
  };

  // #21: her play/jingle'da yeniden peer.call yapmak yolcuya çift ses veriyordu.
  // Peer başına tek aktif çağrı tutulur; force=true yalnızca yayın kaynağı
  // değiştiğinde (yeni MediaStream) kullanılır.
  const callEveryone = (force = false) => {
    const peer = peerRef.current;
    const stream = radioStreamRef.current;
    if (!peer || !stream) return;
    connectionsRef.current.forEach((c) => {
      if (!c.open) return;
      if (force) callPeer(peer, c.peer, stream);
      else ensureCall(peer, c.peer, stream);
    });
  };

  const requestTitle = (r: SongRequest) => `${r.title} · ${riderLabel(r).toUpperCase()} İSTEĞİ`;

  const requestRiderLine = (r: SongRequest) => `· ${riderLabel(r).toUpperCase()} İSTEĞİ`;

  const sendState = (isPlaying: boolean, idx: number) => {
    const req = nowRequestRef.current;
    broadcast({
      type: "radio",
      playing: isPlaying,
      title: req ? req.title : (tracksRef.current[idx]?.name ?? null),
      rider: req ? `${riderLabel(req).toUpperCase()} İSTEĞİ` : null,
      index: idx,
      total: tracksRef.current.length,
      ts: Date.now(),
    });
  };

  const playIndex = async (idx: number) => {
    const list = tracksRef.current;
    if (list.length === 0) return;
    const safe = ((idx % list.length) + list.length) % list.length;
    ensureGraph();
    // Çalan bir istek varken normal listeye geçildiyse o istek tüketilmiş sayılır.
    if (nowRequestRef.current) consumeRequestRef.current(nowRequestRef.current);
    nowRequestRef.current = null;
    setNowRequest(null);
    const el = audioRef.current!;
    const track = list[safe]!;
    if (el.src !== track.url) el.src = track.url;
    // Kopma/yenileme sonrası: aynı parça yarıda kalmışsa kaldığı saniyeden başlar.
    const resume =
      libResumeRef.current && libResumeRef.current.trackId === track.id
        ? libResumeRef.current
        : null;
    libResumeRef.current = null;
    if (resume && resume.position > LIBRARY_REWIND_SEC) {
      const at = Math.max(0, resume.position - LIBRARY_REWIND_SEC);
      const seek = () => {
        try {
          el.currentTime = at;
        } catch {
          /* ignore */
        }
      };
      if (el.readyState >= 1) seek();
      else el.addEventListener("loadedmetadata", seek, { once: true });
    }
    try {
      wantPlayRef.current = true;
      await el.play();
      setIndex(safe);

      setPlaying(true);
      setNowPlaying(track.name);
      setPlaybackState(true);
      callEveryone();
      sendState(true, safe);
      setErr(null);
      void saveLibraryState({
        trackId: track.id,
        index: safe,
        position: resume ? Math.max(0, resume.position - LIBRARY_REWIND_SEC) : 0,
        ts: Date.now(),
      });
    } catch {
      setErr("Çalma başlatılamadı. Ekrana bir kez dokunup tekrar deneyin.");
    }
  };
  const playIndexRef = useRef(playIndex);
  playIndexRef.current = playIndex;

  const next = () => void playIndex(indexRef.current + 1);
  const prev = () => void playIndex(indexRef.current - 1);

  /** Anons/jingle çalarken müziği kıs, bitince geri aç. */
  const duck = (on: boolean) => {
    const el = audioRef.current;
    if (el) el.volume = on ? 0.12 : 1;
  };

  // ---- Telsiz: bas-konuş (şoför → tüm dinleyen yolcular) ----
  const micStreamRef = useRef<MediaStream | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const [talking, setTalking] = useState(false);
  const [micErr, setMicErr] = useState<string | null>(null);

  /** Yayın hattına kısa telsiz hışırtısı basar (yolcular da duyar). */
  const squelchBurst = (durationMs: number, peak: number) => {
    const ctx = ctxRef.current;
    const out = gainRef.current;
    if (!ctx || !out) return;
    const dur = durationMs / 1000;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 1800;
    band.Q.value = 0.9;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.03, dur / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(gain).connect(out);
    src.start(t);
    src.stop(t + dur);
  };

  const startTalk = async () => {
    if (talking) return;
    setMicErr(null);
    try {
      ensureGraph();
      const ctx = ctxRef.current!;
      const dest = destRef.current!;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;
      const src = ctx.createMediaStreamSource(stream);
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 1700;
      band.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.value = 1.4;
      // Mikrofon sadece yayına gider (kendi hoparlörüne gitmez → uğuldama olmaz)
      src.connect(band).connect(gain).connect(dest);
      micGainRef.current = gain;
      duck(true);
      callEveryone();
      squelchBurst(170, 0.12);
      setTalking(true);
    } catch {
      setMicErr("Mikrofon açılamadı. Tarayıcı izni verilmemiş olabilir.");
    }
  };

  const stopTalk = () => {
    if (!talking) return;
    setTalking(false);
    micGainRef.current?.disconnect();
    micGainRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    squelchBurst(110, 0.08);
    window.setTimeout(() => duck(false), 160);
  };

  useEffect(
    () => () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  /**
   * #5: Anons/jingle sesleri internetten gelir. Bağlantı yoksa ya da yavaşsa
   * beklemeden vazgeçilir; müzik yerel dosyadan kesintisiz devam eder.
   */
  const loadVoice = async (ctx: AudioContext, url: string) => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new Error("offline");
    }
    return await Promise.race([
      loadBuffer(ctx, url),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("timeout")), 4000),
      ),
    ]);
  };

  const runJingle = async (url: string, soft: boolean, label: string) => {
    if (busyRef.current) return;
    ensureGraph();
    const ctx = ctxRef.current!;
    const out = gainRef.current!;
    busyRef.current = true;
    setOnAir(label);
    // Teypte jingle/anons adı görünmez; çalan müziğin adı ekranda kalır.
    duck(true);
    callEveryone();
    broadcast({
      type: "radio",
      playing: true,
      // Teypte/kilit ekranında müzik adı kalsın; jingle etiketi gönderilmez.
      title: tracksRef.current[indexRef.current]?.name ?? null,
      rider: null,
      index: indexRef.current,
      total: tracksRef.current.length,
      ts: Date.now(),
    });
    try {
      const buf = await loadVoice(ctx, url);
      await playJingle(ctx, out, { voice: buf, soft });
      setErr(null);
    } catch {
      // Ses indirilemediyse (internet yok) en azından müzikal jingle çalsın.
      await playJingle(ctx, out, { voice: null, soft, bedDuration: 3.2 });
      setErr("Anons sesi indirilemedi; sadece jingle çalındı.");
    }
    duck(false);
    setOnAir(null);
    busyRef.current = false;
    const stillPlaying = !audioRef.current?.paused;
    setNowPlaying(tracksRef.current[indexRef.current]?.name ?? null);
    setPlaybackState(stillPlaying);
    sendState(stillPlaying, indexRef.current);
  };

  /** Tek bir ses tamponunu yayın hattından çalar (jingle dokusu olmadan). */
  const playVoiceBuffer = (ctx: AudioContext, out: AudioNode, buf: AudioBuffer) =>
    new Promise<void>((resolve) => {
      const g = ctx.createGain();
      g.gain.value = 1.25;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(g).connect(out);
      src.onended = () => resolve();
      src.start();
      // Bazı tarayıcılarda onended gelmezse emniyet zamanlayıcısı.
      window.setTimeout(() => resolve(), (buf.duration + 1) * 1000);
    });

  /**
   * Durak anonsu: ilk ses jingle dokusuyla girer, arkasından gelen sesler
   * (ör. esprili kapanış) araya jingle koymadan peş peşe çalar.
   */
  const runAnnouncement = async (a: RadioAnnouncement) => {
    if (busyRef.current) return false;
    ensureGraph();
    const ctx = ctxRef.current!;
    const out = gainRef.current!;
    busyRef.current = true;
    setOnAir(a.label);
    duck(true);
    callEveryone();
    broadcast({
      type: "radio",
      playing: true,
      title: tracksRef.current[indexRef.current]?.name ?? null,
      rider: null,
      index: indexRef.current,
      total: tracksRef.current.length,
      ts: Date.now(),
    });
    try {
      const [first, ...rest] = a.urls;
      const buf = first ? await loadVoice(ctx, first) : null;
      await playJingle(ctx, out, { voice: buf, soft: a.soft ?? false, bedDuration: 2.6 });
      for (const url of rest) {
        const extra = await loadVoice(ctx, url);
        await playVoiceBuffer(ctx, out, extra);
      }
      setErr(null);
    } catch {
      setErr("Durak anonsu sesi çalınamadı.");
    }
    duck(false);
    setOnAir(null);
    busyRef.current = false;
    const stillPlaying = !audioRef.current?.paused;
    setNowPlaying(tracksRef.current[indexRef.current]?.name ?? null);
    setPlaybackState(stillPlaying);
    sendState(stillPlaying, indexRef.current);
    return true;
  };
  const runAnnouncementRef = useRef(runAnnouncement);
  runAnnouncementRef.current = runAnnouncement;

  /** Sırada bekleyen durak anonsları (şarkı aralarında yayına girer). */
  const announceQueueRef = useRef<RadioAnnouncement[]>([]);

  /** Sıradaki anonsu çalar; sıra boşsa false döner. */
  const drainAnnouncements = async () => {
    let played = false;
    while (announceQueueRef.current.length > 0) {
      const a = announceQueueRef.current.shift()!;
      const ok = await runAnnouncementRef.current(a);
      played = played || ok;
    }
    return played;
  };
  const drainAnnouncementsRef = useRef(drainAnnouncements);
  drainAnnouncementsRef.current = drainAnnouncements;

  // Dışarıdan (durak mantığı veya test düğmeleri) gelen anonsları sıraya alır.
  useEffect(
    () =>
      onRadioAnnouncement((a) => {
        if (announceQueueRef.current.some((q) => q.id === a.id)) return;
        announceQueueRef.current.push(a);
        const el = audioRef.current;
        // Yayın boşsa ya da "hemen" işaretliyse şarkı bitişini bekleme.
        if (!busyRef.current && (a.immediate || !el || el.paused)) {
          void drainAnnouncementsRef.current();
        }
      }),
    [],
  );

  /** İstek şarkısı anonsu: hazır mp3 ("Elektro Radyo, istek üzerine çalıyor"). */
  const announceRequest = async (req: SongRequest) => {
    ensureGraph();
    const ctx = ctxRef.current!;
    const out = gainRef.current!;
    busyRef.current = true;
    setOnAir(`🎧 İSTEK · ${riderLabel(req)}`);
    duck(true);
    callEveryone();
    try {
      const buf = await loadVoice(ctx, requestAnnouncementUrl());
      await playJingle(ctx, out, { voice: buf, soft: false });
    } catch {
      // Anons sesi indirilemezse en azından jingle çalsın.
      await playJingle(ctx, out, { voice: null, soft: false, bedDuration: 2.6 });
    }
    duck(false);
    busyRef.current = false;
  };

  /** Yolcu isteğini anonsla birlikte yayına alır. */
  const playRequest = async (req: SongRequest) => {
    // Bu parça daha önce çalınıp bitmişse bir daha yayına alınmaz.
    if (playedRef.current.has(req.id)) {
      consumeRequestRef.current(req);
      return;
    }
    setQueue((prev) => prev.filter((r) => r.id !== req.id));
    queueRef.current = queueRef.current.filter((r) => r.id !== req.id);
    // Kopma sonrası devam: aynı parça yarıda kalmışsa anonsu tekrarlamayız,
    // birkaç saniye geri sarıp kaldığı yerden başlatırız.
    const resume = resumeRef.current?.id === req.id ? resumeRef.current : null;
    resumeRef.current = null;
    setResumeId(null);
    if (!resume) await announceRequest(req);
    ensureGraph();
    const el = audioRef.current!;
    el.src = req.url;
    if (resume) {
      const at = Math.max(0, resume.position - RESUME_REWIND_SEC);
      const seek = () => {
        try {
          el.currentTime = at;
        } catch {
          /* ignore */
        }
      };
      if (el.readyState >= 1) seek();
      else el.addEventListener("loadedmetadata", seek, { once: true });
    }
    try {
      wantPlayRef.current = true;
      await el.play();
      nowRequestRef.current = req;

      setNowRequest(req);
      setPlaying(true);
      setNowPlaying(requestTitle(req));
      setPlaybackState(true);
      callEveryone();
      sendState(true, indexRef.current);
      setOnAir(null);
      setErr(null);
    } catch {
      setOnAir(null);
      setErr("İstek şarkısı çalınamadı.");
    }
  };
  const playRequestRef = useRef(playRequest);
  playRequestRef.current = playRequest;

  /**
   * Kopma/yenileme sonrası elle basmadan devam: parçayı hemen başlatmayı dener.
   * Tarayıcı otomatik çalmayı engellerse ilk dokunuşta kendiliğinden başlar.
   */
  const autoResume = async (req: SongRequest) => {
    const el = audioRef.current;
    if (busyRef.current || (el && !el.paused)) return;
    // Otomatik çalma engellenirse aynı andan devam edebilmek için notu saklarız.
    const snapshot = resumeRef.current;
    await playRequestRef.current(req);
    if (audioRef.current && !audioRef.current.paused) return;
    setErr("Devam için ekrana bir kez dokunun.");
    const retry = () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      const cur = audioRef.current;
      if (busyRef.current || (cur && !cur.paused)) return;
      if (snapshot?.id === req.id) {
        resumeRef.current = snapshot;
        setResumeId(req.id);
      }
      void playRequestRef.current(req);
    };
    window.addEventListener("pointerdown", retry, { once: true });
    window.addEventListener("keydown", retry, { once: true });
  };

  /** Şarkı bittiğinde: istek sırası → jingle → sıradaki parça. */
  const afterTrack = async () => {
    if (nowRequestRef.current) {
      // Sonuna kadar çaldı → kalıcı işaret koy, kaydı ve devam notunu temizle.
      consumeRequestRef.current(nowRequestRef.current);
      void clearProgress();
      nowRequestRef.current = null;
      setNowRequest(null);
    } else {
      playedCountRef.current += 1;
    }
    const pending = queueRef.current[0];
    if (autoRequestsRef.current && pending) {
      await playRequest(pending);
      return;
    }
    // Durak anonsları jingle'dan önceliklidir; ikisi üst üste binmez.
    const announced = await drainAnnouncementsRef.current();
    const every = Math.max(1, jingleEveryRef.current);
    if (!announced && jingleOnRef.current && playedCountRef.current % every === 0) {
      await runJingle(randomJingleUrl(), false, "🎙 ELEKTRO RADYO");
    }
    next();
  };
  const afterTrackRef = useRef(afterTrack);
  afterTrackRef.current = afterTrack;

  // Kopma/yenileme sonrası: kalıcı depodaki istekleri sıraya geri koy,
  // yarıda kalan parçayı listenin başına al.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [songs, progress, playedIds] = await Promise.all([
        listSongs(),
        loadProgress(),
        listPlayedIds(),
      ]);
      if (cancelled) return;
      playedIds.forEach((id) => playedRef.current.add(id));
      // Daha önce çalınmış parçalar geri yüklenmez, kalıntı kayıtları silinir.
      const pending = songs.filter((s) => {
        if (!playedRef.current.has(s.id)) return true;
        void deleteSong(s.id);
        return false;
      });
      if (pending.length === 0) {
        if (progress && playedRef.current.has(progress.id)) void clearProgress();
        return;
      }
      const restored: SongRequest[] = pending.map((s) => ({
        id: s.id,
        title: s.title,
        rider: s.rider,
        stopName: s.stopName,
        url: URL.createObjectURL(s.blob),
        peerId: s.peerId,
        ts: s.ts,
      }));
      const half =
        progress && progress.position > RESUME_REWIND_SEC
          ? restored.find((r) => r.id === progress.id)
          : undefined;
      if (half && progress) {
        resumeRef.current = progress;
        setResumeId(half.id);
      } else {
        void clearProgress();
      }
      const ordered = half ? [half, ...restored.filter((r) => r.id !== half.id)] : restored;
      setQueue((prev) => {
        const have = new Set(prev.map((r) => r.id));
        const merged = [...prev, ...ordered.filter((r) => !have.has(r.id))];
        queueRef.current = merged;
        return merged;
      });
      // Şoför elle basmasın: yayın boştaysa yarıda kalan parça hemen devam etsin.
      const target = ordered[0];
      if (target && autoRequestsRef.current) void autoResume(target);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Çalan istek parçasının anını birkaç saniyede bir not et.
  useEffect(() => {
    const id = window.setInterval(() => {
      const req = nowRequestRef.current;
      const el = audioRef.current;
      if (!el || el.paused || busyRef.current) return;
      if (req) {
        void saveProgress({ id: req.id, position: el.currentTime, ts: Date.now() });
        return;
      }
      // Şoför listesi: o an çalan parça ve kaldığı saniye de kalıcı olarak not edilir.
      const track = tracksRef.current[indexRef.current];
      if (!track) return;
      void saveLibraryState({
        trackId: track.id,
        index: indexRef.current,
        position: el.currentTime,
        ts: Date.now(),
      });
    }, 3000);
    return () => window.clearInterval(id);
  }, []);

  // Açılışta: cihazda saklı çalma listesini geri yükle, kaldığı yerden devam et.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [stored, state] = await Promise.all([listTracks(), loadLibraryState()]);
      if (cancelled || stored.length === 0) return;
      const restored: Track[] = stored.map((s) => ({
        id: s.id,
        name: s.name,
        url: URL.createObjectURL(s.blob),
      }));
      tracksRef.current = restored;
      setTracks(restored);
      const at = state ? restored.findIndex((t) => t.id === state.trackId) : -1;
      const startIndex = at >= 0 ? at : 0;
      indexRef.current = startIndex;
      setIndex(startIndex);
      if (state && at >= 0) libResumeRef.current = state;
      // Yolcu isteği yayına girdiyse ya da bir şey çalıyorsa araya girilmez.
      const el = audioRef.current;
      if (nowRequestRef.current || busyRef.current || (el && !el.paused)) return;
      if (!state || at < 0 || state.position <= 0) return;
      await playIndexRef.current(startIndex);
      const cur = audioRef.current;
      if (cur && !cur.paused) return;
      // Tarayıcı otomatik çalmayı engellerse ilk dokunuşta devam eder.
      setErr("Devam için ekrana bir kez dokunun.");
      const snapshot = state;
      const retry = () => {
        window.removeEventListener("pointerdown", retry);
        window.removeEventListener("keydown", retry);
        const now = audioRef.current;
        if (nowRequestRef.current || busyRef.current || (now && !now.paused)) return;
        libResumeRef.current = snapshot;
        void playIndexRef.current(startIndex);
      };
      window.addEventListener("pointerdown", retry, { once: true });
      window.addEventListener("keydown", retry, { once: true });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Yolculardan P2P ile gelen istek şarkıları
  useEffect(
    () =>
      onSongRequest((req) => {
        // Aynı istek daha önce çalınmışsa (veya sırada duruyorsa) tekrar eklenmez.
        if (playedRef.current.has(req.id)) {
          void deleteSong(req.id);
          return;
        }
        if (queueRef.current.some((r) => r.id === req.id) || nowRequestRef.current?.id === req.id)
          return;
        setQueue((prev) => [...prev, req]);
        queueRef.current = [...queueRef.current, req];
        const conn = Array.from(connectionsRef.current).find((c) => c.peer === req.peerId);
        try {
          conn?.send({
            type: "song-ack",
            id: req.id,
            ok: true,
            queue: queueRef.current.length,
            ts: Date.now(),
          } as SongAckPayload);
        } catch {
          /* ignore */
        }
        const el = audioRef.current;
        // Yayın boştaysa isteği hemen yayına al
        if (autoRequestsRef.current && !busyRef.current && (!el || el.paused)) {
          void playRequestRef.current(req);
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const playStationId = () => void runJingle(randomJingleUrl(), false, "🎙 ELEKTRO RADYO");

  const playHourAnnouncement = async () => {
    await runJingle(hourAnnouncementUrl(), true, "🕐 SAAT ANONSU");
  };

  // Saat başı anonsu (yayın açıkken)
  useEffect(() => {
    const id = window.setInterval(() => {
      const h = new Date().getHours();
      if (h === lastHourRef.current) return;
      lastHourRef.current = h;
      if (hourlyOn && !busyRef.current) void playHourAnnouncement();
    }, 20000);
    return () => window.clearInterval(id);
  }, [hourlyOn]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el || !el.src) {
      void playIndex(indexRef.current);
      return;
    }
    if (el.paused) {
      wantPlayRef.current = true;
      void el.play();
      setPlaying(true);
      setPlaybackState(true);
      callEveryone();
      sendState(true, indexRef.current);
    } else {
      wantPlayRef.current = false;
      el.pause();
      setPlaying(false);
      setPlaybackState(false);
      sendState(false, indexRef.current);
    }
  };

  /**
   * #5/#6 Kesintisiz yerel çalma bekçisi.
   * Ses öğesi ve AudioContext hiç sıfırlanmaz; sadece askıya alınmışsa
   * uyandırılır. Bağlantı kopması/yeniden bağlanma ses akışına dokunmaz.
   */
  useEffect(() => {
    const revive = () => {
      if (!wantPlayRef.current || busyRef.current) return;
      const ctx = ctxRef.current;
      if (ctx && ctx.state !== "running") void ctx.resume();
      const el = audioRef.current;
      if (el && el.src && el.paused) {
        const p = el.play();
        if (p) p.catch(() => undefined);
      }
    };
    const onPause = () => window.setTimeout(revive, 60);
    const events = ["pause", "stalled", "suspend", "waiting"] as const;
    let bound: HTMLAudioElement | null = null;
    const bind = () => {
      const el = audioRef.current;
      if (!el || bound === el) return;
      bound = el;
      events.forEach((e) => el.addEventListener(e, onPause));
    };
    bind();
    const id = window.setInterval(() => {
      bind();
      revive();
    }, 1000);

    window.addEventListener("online", revive);
    window.addEventListener("offline", revive);
    window.addEventListener("pageshow", revive);
    document.addEventListener("visibilitychange", revive);
    return () => {
      window.clearInterval(id);
      if (bound) events.forEach((e) => bound!.removeEventListener(e, onPause));
      window.removeEventListener("online", revive);
      window.removeEventListener("offline", revive);
      window.removeEventListener("pageshow", revive);
      document.removeEventListener("visibilitychange", revive);
    };
  }, []);

  // Araç teybi / Bluetooth ekranında parça adı ve tuş kontrolleri
  useEffect(() => {
    setMediaHandlers({ play: toggle, pause: toggle, next, prev });
    return () => setMediaHandlers({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Durumu düzenli yayınla: sonradan bağlanan yolcu da doğru parçayı görsün
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = audioRef.current;
      if (!el || !el.src) return;
      if (busyRef.current) return;
      sendState(!el.paused, indexRef.current);
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
  }, [volume]);

  useEffect(() => {
    if (monitorGainRef.current) monitorGainRef.current.gain.value = monitor ? 1 : 0;
  }, [monitor]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      tracksRef.current.forEach((t) => URL.revokeObjectURL(t.url));
      radioStreamRef.current = null;
      void ctxRef.current?.close();
    },
    [],
  );

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {
      setErr("Dosya seçilmedi. Telefonda 'Dosyalar' veya 'Ses' uygulamasından seçmeyi deneyin.");
      return;
    }
    // Mobilde f.type çoğu zaman boş gelir; sadece açıkça ses olmayanları eleriz.
    const list = Array.from(files);
    const rejected = list.filter(
      (f) =>
        (f.type &&
          !f.type.startsWith("audio/") &&
          !f.type.startsWith("application/octet-stream")) ||
        /\.(jpg|jpeg|png|gif|heic|webp|mp4|mov|pdf|txt|doc|docx|zip)$/i.test(f.name),
    );
    const accepted = list.filter((f) => !rejected.includes(f));
    const base = tracksRef.current.length;
    const added = accepted.map((f, i) => ({
      id: `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      name: f.name.replace(/\.[^.]+$/, "") || "Parça",
      url: URL.createObjectURL(f),
      file: f,
      order: base + i,
    }));
    if (added.length === 0) {
      setErr(
        `Müzik bulunamadı (${list.length} dosya elendi). Telefonda MP3'leri "Dosyalar" uygulamasından seçin.`,
      );
      return;
    }
    setErr(rejected.length > 0 ? `${rejected.length} dosya ses olmadığı için atlandı.` : null);
    // Dosyalar cihazda saklanır: her açılışta yeniden seçmeye gerek kalmaz.
    void saveTracks(
      added.map((t) => ({
        id: t.id,
        name: t.name,
        order: t.order,
        mime: t.file.type || "audio/mpeg",
        ts: Date.now(),
        blob: t.file,
      })),
    );
    const plain = added.map((t) => ({ id: t.id, name: t.name, url: t.url }));
    tracksRef.current = [...tracksRef.current, ...plain];
    setTracks((prev) => [...prev, ...plain]);
  };

  /** Listeden bir parçayı kalıcı olarak kaldırır. */
  const removeTrack = (id: string) => {
    const list = tracksRef.current;
    const gone = list.find((t) => t.id === id);
    const rest = list.filter((t) => t.id !== id);
    tracksRef.current = rest;
    setTracks(rest);
    void deleteTrack(id);
    void reorderTracks(rest.map((t) => t.id));
    if (gone) {
      try {
        URL.revokeObjectURL(gone.url);
      } catch {
        /* ignore */
      }
    }
    setIndex((i) => Math.max(0, Math.min(i, rest.length - 1)));
  };

  /** Kayıtlı tüm dosyaları ve devam notunu siler. */
  const clearLibrary = () => {
    audioRef.current?.pause();
    setPlaying(false);
    tracksRef.current.forEach((t) => {
      try {
        URL.revokeObjectURL(t.url);
      } catch {
        /* ignore */
      }
    });
    tracksRef.current = [];
    setTracks([]);
    setIndex(0);
    libResumeRef.current = null;
    void clearTracks();
  };

  const current = tracks[index] ?? null;

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="hud-label">Servis Radyosu</div>
        <div className="text-[11px] font-mono text-muted-foreground">
          {tracks.length} PARÇA · {listeningCount}/{connectionsRef.current.size} DİNLİYOR
        </div>
      </div>

      <label className="block">
        <span className="sr-only">Müzik dosyaları seç</span>
        <input
          type="file"
          accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus,.wma"
          multiple
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
          className="w-full text-sm file:mr-3 file:px-4 file:py-2 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:font-semibold text-muted-foreground"
        />
      </label>
      <p className="text-xs text-muted-foreground mt-2">
        USB'den telefona kopyaladığın MP3'leri seç; yayın açıkken tüm yolcular canlı dinler.
      </p>

      <div className="mt-4 rounded-md border border-border bg-card/80 p-4">
        <div className="text-[11px] font-mono text-muted-foreground mb-2">
          {onAir ? "JINGLE" : nowRequest ? "İSTEK YAYINDA" : playing ? "YAYINDA" : "DURAKLATILDI"}
          {tracks.length > 0 && ` · ${index + 1}/${tracks.length}`}
        </div>
        <RequestDisplay
          title={
            onAir
              ? current
                ? current.name
                : null
              : nowRequest
                ? nowRequest.title
                : current
                  ? current.name
                  : null
          }
          rider={nowRequest && !onAir ? `${riderLabel(nowRequest).toUpperCase()} İSTEĞİ` : null}
        />
        {/* #27: yolcular gerçekten duyuyor mu? */}
        <div className="text-[11px] font-mono mt-3">
          <span className="text-muted-foreground">SES ULAŞAN: </span>
          {receivingCount}/{connectionsRef.current.size}
          <span className="text-muted-foreground"> · SESİ AÇAN: </span>
          {listeningCount}
        </div>
      </div>

      {/* Telsiz: basılı tut, konuş — tüm dinleyen yolcular duyar */}
      <div className="mt-3 rounded-md border border-border p-3">
        <div className="hud-label mb-2">Telsiz · Yolculara Anons</div>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            void startTalk();
          }}
          onPointerUp={stopTalk}
          onPointerLeave={stopTalk}
          onPointerCancel={stopTalk}
          className={`w-full select-none rounded-md py-4 text-base font-bold transition ${
            talking
              ? "bg-destructive text-destructive-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
          style={{ touchAction: "none" }}
        >
          {talking ? "🎙 KONUŞ · YAYINDA" : "🎙 BASILI TUT & KONUŞ"}
        </button>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Basılı tuttuğun sürece müzik kısılır, sesin telsiz hışırtısıyla tüm yolculara gider.
        </p>
        {micErr && <p className="mt-2 text-xs text-destructive">{micErr}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <button
          onClick={prev}
          disabled={tracks.length === 0}
          className="py-2.5 rounded-md border border-border font-semibold hover:bg-muted/50 disabled:opacity-40"
        >
          ⏮ Önceki
        </button>
        <button
          onClick={toggle}
          disabled={tracks.length === 0}
          className="py-2.5 rounded-md bg-primary text-primary-foreground font-bold hover:bg-primary/90 disabled:opacity-40"
        >
          {playing ? "⏸ Duraklat" : "▶ Çal"}
        </button>
        <button
          onClick={next}
          disabled={tracks.length === 0}
          className="py-2.5 rounded-md border border-border font-semibold hover:bg-muted/50 disabled:opacity-40"
        >
          ⏭ Sonraki
        </button>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <span className="hud-label">Ses</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="flex-1 accent-primary"
          aria-label="Yayın ses seviyesi"
        />
        <span className="text-xs font-mono w-10 text-right">{Math.round(volume * 100)}%</span>
      </div>

      <label className="flex items-center gap-2 mt-3 text-xs text-muted-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={monitor}
          onChange={(e) => setMonitor(e.target.checked)}
          className="w-4 h-4 accent-primary"
        />
        Müziği kendi telefonumdan da duy
      </label>

      <div className="mt-4 rounded-md border border-border p-3">
        <div className="hud-label mb-2">Jingle & Anonslar</div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={jingleOn}
            onChange={(e) => setJingleOn(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          "Elektro Radyo" jingle çalsın
        </label>
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <span>Her</span>
          <select
            value={jingleEvery}
            onChange={(e) => setJingleEvery(Number(e.target.value))}
            className="bg-transparent border border-border rounded px-2 py-1 text-foreground"
            aria-label="Jingle sıklığı"
          >
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
            <option value={5}>5</option>
          </select>
          <span>şarkıda bir</span>
        </div>
        <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={hourlyOn}
            onChange={(e) => setHourlyOn(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          Saat başı anonsu ("Saat 09:00, Acrob Servis Radyosu")
        </label>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button
            onClick={playStationId}
            className="py-2 rounded-md border border-border font-semibold text-sm hover:bg-muted/50"
          >
            🎙 Jingle Çal
          </button>
          <button
            onClick={() => void playHourAnnouncement()}
            className="py-2 rounded-md border border-border font-semibold text-sm hover:bg-muted/50"
          >
            🕐 Saat Anonsu
          </button>
        </div>
        <div className="hud-label mt-4 mb-2">Hızlı Uyarı</div>
        <div className="grid grid-cols-1 gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => queueRadioAnnouncement(stopAnnouncement("notToday"))}
              className="flex-1 py-2 rounded-md border border-destructive/40 text-destructive font-semibold text-xs hover:bg-destructive/10 text-left px-3"
            >
              ⚠️ Bugün Yokum
              <span className="block text-[10px] font-normal text-muted-foreground">
                "Servisimiz bugün çalışmayacaktır" · şarkı bitince yayına girer
              </span>
            </button>
            <button
              onClick={() => queueRadioAnnouncement(stopAnnouncement("notToday", true))}
              className="px-3 rounded-md border border-destructive/40 text-destructive text-xs font-semibold hover:bg-destructive/10"
              aria-label="Bugün Yokum hemen çal"
            >
              Hemen
            </button>
          </div>
        </div>
        <div className="hud-label mt-4 mb-2">
          Durak Anonsları — konuma göre otomatik çalar (elle de çalabilirsiniz)
        </div>
        <div className="grid grid-cols-1 gap-2">
          {(
            [
              ["bakery2min", "🥐 25 Saat Fırın · 2 dk kala"],
              ["bakeryNear", "🥐 25 Saat Fırın · yaklaşıyoruz + espri"],
              ["factory", "🏭 Eloktroland · vardık"],
            ] as [StopAnnouncementKey, string][]
          ).map(([key, label]) => (
            <div key={key} className="flex gap-2">
              <button
                onClick={() => queueRadioAnnouncement(stopAnnouncement(key))}
                className="flex-1 py-2 rounded-md border border-border font-semibold text-xs hover:bg-muted/50 text-left px-3"
              >
                {label}
                <span className="block text-[10px] font-normal text-muted-foreground">
                  şarkı bitince yayına girer
                </span>
              </button>
              <button
                onClick={() => queueRadioAnnouncement(stopAnnouncement(key, true))}
                className="px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted/50"
                aria-label={`${label} hemen çal`}
              >
                Hemen
              </button>
            </div>
          ))}
        </div>
        {announceQueueRef.current.length > 0 ? (
          <div className="text-[11px] text-muted-foreground mt-2">
            {announceQueueRef.current.length} anons sırada
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-md border border-border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="hud-label">Yolcu İstekleri</div>
          <span className="text-[11px] font-mono text-muted-foreground">{queue.length} SIRADA</span>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={autoRequests}
            onChange={(e) => setAutoRequests(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          İstekler sırası gelince otomatik çalsın (anonslu)
        </label>
        {queue.length === 0 ? (
          <div className="text-xs text-muted-foreground mt-2">
            Yolcular radyo sekmesinden müzik gönderdiğinde burada sıraya girer.
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
            {queue.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-border text-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate font-semibold">{r.title}</div>
                  <div className="text-[11px] font-mono text-muted-foreground truncate">
                    {riderLabel(r)}
                    {resumeId === r.id && " · KALDIĞI YERDEN"}
                  </div>
                </div>
                <button
                  onClick={() => void playRequest(r)}
                  className="px-2 py-1 rounded border border-border text-xs hover:bg-muted/50"
                >
                  ▶ Çal
                </button>
                <button
                  onClick={() => consumeRequest(r)}
                  className="px-2 py-1 rounded border border-border text-xs hover:bg-muted/50"
                  aria-label="İsteği sil"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {tracks.length > 0 && (
        <>
          <div className="mt-4 flex items-center justify-between">
            <div className="hud-label">Çalma Listesi (cihazda kayıtlı)</div>
            <button
              onClick={clearLibrary}
              className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted/50"
            >
              Listeyi temizle
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
            {tracks.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2">
                <button
                  onClick={() => void playIndex(i)}
                  className={`flex-1 min-w-0 text-left px-3 py-2 rounded-md border text-sm truncate ${
                    i === index ? "border-primary text-primary" : "border-border hover:bg-muted/40"
                  }`}
                >
                  {i + 1}. {t.name}
                </button>
                <button
                  onClick={() => removeTrack(t.id)}
                  className="px-2 py-2 rounded border border-border text-xs hover:bg-muted/50"
                  aria-label={`${t.name} parçasını listeden çıkar`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {err && <div className="mt-3 text-xs text-red-400">{err}</div>}
    </div>
  );
}
