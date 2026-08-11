// Bulgu 3 & 4: PeerJS/WebRTC bağlantı dayanıklılığı.
// Mobil operatör NAT'larında sadece STUN yetmez; ücretsiz açık TURN sunucuları
// yedek olarak eklendi. Böylece 4G/5G'deki yolcular da şoföre bağlanabilir.
//
// YAPILACAKLAR3 B bölümü (#14–#20): bağlantı zaman aşımı, ICE izleme,
// kalp atışı/pong ile ölü bağlantı temizliği, ikinci TURN sağlayıcı ve
// açılışta röle (TURN) erişilebilirlik testi.

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:global.stun.twilio.com:3478"] },
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  // #18: ikinci ücretsiz TURN sağlayıcı (openrelay kotası dolarsa yedek)
  {
    urls: ["turn:freeturn.net:3478", "turn:freeturn.net:5349?transport=tcp"],
    username: "free",
    credential: "free",
  },
];

/** Tüm Peer örneklerinin kullanacağı ortak ayarlar. */
export const PEER_OPTIONS = {
  debug: 1,
  config: { iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 },
} as const;

/** Bulgu 4: kademeli yeniden bağlanma gecikmesi (2s → 30s, hafif rastgele). */
export function reconnectDelay(attempt: number): number {
  const base = Math.min(30000, 2000 * Math.pow(1.6, Math.max(0, attempt)));
  return Math.round(base * (0.85 + Math.random() * 0.3));
}

/**
 * YAPILACAKLAR3 #52: şoför henüz yayında değilken (peer-unavailable) sonsuz
 * yeniden deneme; kısa ve öngörülebilir aralık: 3s → 5s → 10s (üst sınır).
 */
export function waitingRetryDelay(attempt: number): number {
  const steps = [3000, 5000, 10000];
  const base = steps[Math.min(attempt, steps.length - 1)]!;
  return Math.round(base * (0.9 + Math.random() * 0.2));
}

/**
 * YAPILACAKLAR3 #55: bağlantı açık görünse bile bu süredir hiç paket gelmiyorsa
 * şoför "zombie" sayılır (kimlik sunucuda asılı kalmış) → yeniden bağlanılır.
 */
export const PRESENCE_TIMEOUT_MS = 15000;

export type LiveStatus = "idle" | "connecting" | "connected" | "offline" | "waiting";

// ---------- #15: bağlantı zaman aşımı ----------
/** `conn.on("open")` bu süre içinde gelmezse bağlantı ölü sayılır. */
export const CONN_OPEN_TIMEOUT_MS = 10000;

// ---------- #17: kalp atışı / pong ----------
export const PING_INTERVAL_MS = 5000;
/** Bu süredir pong gelmeyen bağlantı ölü sayılıp kapatılır. */
export const PONG_TIMEOUT_MS = 20000;

export interface PingPayload {
  type: "ping";
  ts: number;
}
export interface PongPayload {
  type: "pong";
  ts: number;
  /** Yolcu radyo sesini duyabiliyor mu (C bölümü #27 için hazır alan) */
  audioOk?: boolean;
}

// ---------- #16: ICE durumu izleme ----------
type WithPeerConnection = { peerConnection?: RTCPeerConnection | null };

/** DataConnection/MediaConnection içindeki RTCPeerConnection'a güvenli erişim. */
export function getPeerConnection(conn: unknown): RTCPeerConnection | null {
  return (conn as WithPeerConnection)?.peerConnection ?? null;
}

/**
 * ICE bağlantısı `failed`/`disconnected` olduğunda haber verir
 * ("açık ama veri akmayan" zombie bağlantı tespiti). Dönen fonksiyon izlemeyi bırakır.
 */
export function watchIceState(
  conn: unknown,
  onBroken: (state: RTCIceConnectionState) => void,
): () => void {
  const pc = getPeerConnection(conn);
  if (!pc) return () => undefined;
  let disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (disconnectedTimer) clearTimeout(disconnectedTimer);
    disconnectedTimer = null;
  };
  const handler = () => {
    const st = pc.iceConnectionState;
    if (st === "failed") {
      clear();
      onBroken(st);
    } else if (st === "disconnected") {
      // Kısa kopmalar kendiliğinden toparlanabilir; 8 sn beklenir.
      clear();
      disconnectedTimer = setTimeout(() => {
        if (pc.iceConnectionState === "disconnected") onBroken("disconnected");
      }, 8000);
    } else {
      clear();
    }
  };
  pc.addEventListener("iceconnectionstatechange", handler);
  return () => {
    clear();
    pc.removeEventListener("iceconnectionstatechange", handler);
  };
}

/** Mümkünse ICE yeniden başlatma (zombie bağlantı kurtarma denemesi). */
export function tryIceRestart(conn: unknown): boolean {
  const pc = getPeerConnection(conn) as (RTCPeerConnection & { restartIce?: () => void }) | null;
  if (!pc?.restartIce) return false;
  try {
    pc.restartIce();
    return true;
  } catch {
    return false;
  }
}

// ---------- #18: TURN (röle) erişilebilirlik testi ----------
export type RelayStatus = "unknown" | "checking" | "ok" | "unavailable";

/**
 * Sadece TURN sunucularıyla aday toplayıp `relay` adayı gelip gelmediğine bakar.
 * Röle çalışmıyorsa şoför paneli uyarabilir.
 */
export async function checkTurnReachable(timeoutMs = 6000): Promise<boolean> {
  if (typeof RTCPeerConnection === "undefined") return false;
  const turnOnly = ICE_SERVERS.filter((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => String(u).startsWith("turn"));
  });
  if (turnOnly.length === 0) return false;
  let pc: RTCPeerConnection | null = null;
  try {
    pc = new RTCPeerConnection({ iceServers: turnOnly, iceTransportPolicy: "relay" });
    pc.createDataChannel("probe");
    const found = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      pc!.addEventListener("icecandidate", (e) => {
        if (e.candidate && e.candidate.candidate.includes(" typ relay")) {
          clearTimeout(timer);
          resolve(true);
        }
        if (!e.candidate) {
          clearTimeout(timer);
          resolve(false);
        }
      });
    });
    await pc.setLocalDescription(await pc.createOffer());
    return await found;
  } catch {
    return false;
  } finally {
    try {
      pc?.close();
    } catch {
      /* ignore */
    }
  }
}
