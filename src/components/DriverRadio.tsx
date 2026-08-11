import { useEffect, useRef, useState } from "react";
import type Peer from "peerjs";
import type { DataConnection } from "peerjs";
import type { RadioStatePayload } from "@/lib/radio";
import { loadBuffer, playJingle } from "@/lib/jingle";
import { hourAnnouncementUrl, randomJingleUrl } from "@/lib/voice-assets";
import { callPeer, ensureCall } from "@/lib/radio-calls";
import { setMediaHandlers, setNowPlaying, setPlaybackState } from "@/lib/media-session";

interface Track {
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

  const sendState = (isPlaying: boolean, idx: number) => {
    broadcast({
      type: "radio",
      playing: isPlaying,
      title: tracksRef.current[idx]?.name ?? null,
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
    const el = audioRef.current!;
    if (el.src !== list[safe]!.url) el.src = list[safe]!.url;
    try {
      await el.play();
      setIndex(safe);
      setPlaying(true);
      setNowPlaying(list[safe]!.name);
      setPlaybackState(true);
      callEveryone();
      sendState(true, safe);
      setErr(null);
    } catch {
      setErr("Çalma başlatılamadı. Ekrana bir kez dokunup tekrar deneyin.");
    }
  };

  const next = () => void playIndex(indexRef.current + 1);
  const prev = () => void playIndex(indexRef.current - 1);

  /** Anons/jingle çalarken müziği kıs, bitince geri aç. */
  const duck = (on: boolean) => {
    const el = audioRef.current;
    if (el) el.volume = on ? 0.12 : 1;
  };

  const runJingle = async (url: string, soft: boolean, label: string) => {
    if (busyRef.current) return;
    ensureGraph();
    const ctx = ctxRef.current!;
    const out = gainRef.current!;
    busyRef.current = true;
    setOnAir(label);
    setNowPlaying(label);
    duck(true);
    callEveryone();
    broadcast({
      type: "radio",
      playing: true,
      title: label,
      index: indexRef.current,
      total: tracksRef.current.length,
      ts: Date.now(),
    });
    try {
      const buf = await loadBuffer(ctx, url);
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

  /** Şarkı bittiğinde: her N şarkıda bir jingle, sonra sıradaki parça. */
  const afterTrack = async () => {
    playedCountRef.current += 1;
    const every = Math.max(1, jingleEveryRef.current);
    if (jingleOnRef.current && playedCountRef.current % every === 0) {
      await runJingle(randomJingleUrl(), false, "🎙 ELEKTRO RADYO");
    }
    next();
  };
  const afterTrackRef = useRef(afterTrack);
  afterTrackRef.current = afterTrack;

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
      void el.play();
      setPlaying(true);
      setPlaybackState(true);
      callEveryone();
      sendState(true, indexRef.current);
    } else {
      el.pause();
      setPlaying(false);
      setPlaybackState(false);
      sendState(false, indexRef.current);
    }
  };

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
    const added = accepted.map((f) => ({
      name: f.name.replace(/\.[^.]+$/, "") || "Parça",
      url: URL.createObjectURL(f),
    }));
    if (added.length === 0) {
      setErr(
        `Müzik bulunamadı (${list.length} dosya elendi). Telefonda MP3'leri "Dosyalar" uygulamasından seçin.`,
      );
      return;
    }
    setErr(rejected.length > 0 ? `${rejected.length} dosya ses olmadığı için atlandı.` : null);
    setTracks((prev) => [...prev, ...added]);
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

      <div className="mt-4 rounded-md border border-border p-3">
        <div className="hud-label mb-1">Şu An Çalıyor</div>
        <div className="font-bold truncate">{onAir ?? (current ? current.name : "—")}</div>
        <div className="text-[11px] font-mono text-muted-foreground mt-1">
          {onAir ? "JINGLE" : playing ? "YAYINDA" : "DURAKLATILDI"}
          {tracks.length > 0 && ` · ${index + 1}/${tracks.length}`}
        </div>
        {/* #27: yolcular gerçekten duyuyor mu? */}
        <div className="text-[11px] font-mono mt-1">
          <span className="text-muted-foreground">SES ULAŞAN: </span>
          {receivingCount}/{connectionsRef.current.size}
          <span className="text-muted-foreground"> · SESİ AÇAN: </span>
          {listeningCount}
        </div>
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
      </div>

      {tracks.length > 0 && (
        <div className="mt-4 flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
          {tracks.map((t, i) => (
            <button
              key={t.url}
              onClick={() => void playIndex(i)}
              className={`text-left px-3 py-2 rounded-md border text-sm truncate ${
                i === index ? "border-primary text-primary" : "border-border hover:bg-muted/40"
              }`}
            >
              {i + 1}. {t.name}
            </button>
          ))}
        </div>
      )}

      {err && <div className="mt-3 text-xs text-red-400">{err}</div>}
    </div>
  );
}
