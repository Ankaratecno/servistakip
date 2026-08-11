// YAPILACAKLAR3 #21/#23/#24/#27: radyo (WebRTC media) çağrılarının tek yerden
// yönetimi. Peer başına EN FAZLA bir aktif MediaConnection tutulur; yeni çağrı
// açılırken eskisi kapatılır (çift ses/eko ve bellek sızıntısı biter).
// Yolcudan gelen "audio-ok" bildirimi ile ses gerçekten akıyor mu izlenir;
// akmıyorsa çağrı otomatik yenilenir.

import type Peer from "peerjs";
import type { MediaConnection } from "peerjs";

interface CallEntry {
  call: MediaConnection;
  ts: number;
}

/** Ses akışı doğrulaması bu süre içinde yenilenmezse ölü sayılır. */
export const AUDIO_OK_TIMEOUT_MS = 12000;
/** Bir çağrı bu süre içinde onaylanmazsa yeniden kurulur. */
export const CALL_RETRY_MS = 5000;

const calls = new Map<string, CallEntry>();
const streamAck = new Map<string, number>();
const listenAck = new Map<string, number>();

export function closeCall(peerId: string) {
  const entry = calls.get(peerId);
  if (!entry) return;
  calls.delete(peerId);
  try {
    entry.call.close();
  } catch {
    /* ignore */
  }
}

/** Peer'e yayını gönder; varsa eski çağrıyı kapatır. */
export function callPeer(peer: Peer, peerId: string, stream: MediaStream) {
  closeCall(peerId);
  try {
    const call = peer.call(peerId, stream);
    if (!call) return;
    calls.set(peerId, { call, ts: Date.now() });
    const drop = () => {
      if (calls.get(peerId)?.call === call) calls.delete(peerId);
    };
    call.on("close", drop);
    call.on("error", drop);
  } catch {
    /* ignore */
  }
}

/** Zaten aktif çağrı yoksa kur (aynı yolcuya ikinci call atılmaz). */
export function ensureCall(peer: Peer, peerId: string, stream: MediaStream) {
  if (calls.has(peerId)) return;
  callPeer(peer, peerId, stream);
}

export function markAudioOk(peerId: string, listening: boolean) {
  const now = Date.now();
  streamAck.set(peerId, now);
  if (listening) listenAck.set(peerId, now);
  else listenAck.delete(peerId);
}

export function forgetPeer(peerId: string) {
  closeCall(peerId);
  streamAck.delete(peerId);
  listenAck.delete(peerId);
}

export function clearCalls() {
  Array.from(calls.keys()).forEach(closeCall);
  streamAck.clear();
  listenAck.clear();
}

/** #27: ses akışı doğrulanan ve gerçekten dinleyen yolcu sayısı. */
export function audioStats(now = Date.now()) {
  let receiving = 0;
  streamAck.forEach((t) => {
    if (now - t < AUDIO_OK_TIMEOUT_MS) receiving += 1;
  });
  let listening = 0;
  listenAck.forEach((t) => {
    if (now - t < AUDIO_OK_TIMEOUT_MS) listening += 1;
  });
  return { receiving, listening };
}

/**
 * #23/#24: açık tüm bağlantılar için çağrı durumunu düzeltir.
 * - yayın yeni başladıysa mevcut tüm yolculara çağrı atar
 * - ayrılan yolcuların çağrısını kapatır
 * - onay gelmeyen (sessiz kalan) çağrıları yeniler
 */
export function reconcileCalls(peer: Peer, peerIds: string[], stream: MediaStream | null) {
  const live = new Set(peerIds);
  Array.from(calls.keys()).forEach((id) => {
    if (!live.has(id)) forgetPeer(id);
  });
  if (!stream) {
    clearCalls();
    return;
  }
  const now = Date.now();
  peerIds.forEach((id) => {
    const entry = calls.get(id);
    if (!entry) {
      callPeer(peer, id, stream);
      return;
    }
    if (now - entry.ts < CALL_RETRY_MS) return;
    const ack = streamAck.get(id) ?? 0;
    // Çağrı kuruldu ama yolcuda ses hiç oluşmadı ya da akış durdu → tekrar dene.
    if (ack < entry.ts || now - ack > AUDIO_OK_TIMEOUT_MS) callPeer(peer, id, stream);
  });
}
