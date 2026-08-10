// Bulgu 3 & 4: PeerJS/WebRTC bağlantı dayanıklılığı.
// Mobil operatör NAT'larında sadece STUN yetmez; ücretsiz açık TURN sunucuları
// yedek olarak eklendi. Böylece 4G/5G'deki yolcular da şoföre bağlanabilir.

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

export type LiveStatus = "idle" | "connecting" | "connected" | "offline" | "waiting";