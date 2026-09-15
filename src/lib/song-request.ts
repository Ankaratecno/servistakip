// Yolcu şarkı isteği: yolcunun telefonundaki MP3, PeerJS veri kanalından
// parça parça şoföre aktarılır; şoför tarafında sıraya girip anons edilir.

import type { DataConnection } from "peerjs";
import { saveSong } from "@/lib/song-store";

/** Tek seferde gönderilen ham parça boyutu (base64 öncesi). */
const CHUNK_BYTES = 24 * 1024;
/** Kabul edilen en büyük dosya (çok büyük dosya bağlantıyı tıkar). */
export const MAX_SONG_BYTES = 12 * 1024 * 1024;

export interface SongMetaPayload {
  type: "song-meta";
  id: string;
  /** Şarkı adı (dosya adından) */
  title: string;
  /** Yolcunun girdiği ad; boşsa null */
  rider: string | null;
  /** Yolcunun seçtiği durak adı; ad girilmediyse anonsta kullanılır */
  stopName: string | null;
  mime: string;
  size: number;
  chunks: number;
  ts: number;
}

export interface SongChunkPayload {
  type: "song-chunk";
  id: string;
  i: number;
  /** base64 parça */
  b: string;
}

/** Şoförden yolcuya: istek alındı / sıraya girdi. */
export interface SongAckPayload {
  type: "song-ack";
  id: string;
  ok: boolean;
  queue: number;
  ts: number;
}

export interface SongRequest {
  id: string;
  title: string;
  rider: string | null;
  stopName: string | null;
  url: string;
  peerId: string;
  ts: number;
}

function u8ToB64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function cleanTitle(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim() || "Parça";
}

/** Yolcu tarafı: dosyayı parçalara bölüp şoföre gönderir. */
export async function sendSong(
  conn: DataConnection,
  file: File,
  rider: string | null,
  stopName?: string | null,
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (file.size > MAX_SONG_BYTES) throw new Error("Dosya çok büyük (en fazla 12 MB).");
  const buf = new Uint8Array(await file.arrayBuffer());
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const chunks = Math.ceil(buf.length / CHUNK_BYTES);
  const meta: SongMetaPayload = {
    type: "song-meta",
    id,
    title: cleanTitle(file.name),
    rider: rider?.trim() ? rider.trim().slice(0, 24) : null,
    stopName: stopName?.trim() ? stopName.trim().slice(0, 32) : null,
    mime: file.type || "audio/mpeg",
    size: buf.length,
    chunks,
    ts: Date.now(),
  };
  conn.send(meta);
  for (let i = 0; i < chunks; i++) {
    const slice = buf.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
    conn.send({ type: "song-chunk", id, i, b: u8ToB64(slice) } as SongChunkPayload);
    onProgress?.(Math.round(((i + 1) / chunks) * 100));
    // Veri kanalını boğmamak için nefes payı
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 30));
  }
  return id;
}

// ---- Şoför tarafı: parçaları topla ----

interface Pending {
  meta: SongMetaPayload;
  parts: (Uint8Array | undefined)[];
  got: number;
}

const pending = new Map<string, Pending>();
const listeners = new Set<(r: SongRequest) => void>();

/** Şoför panelindeki radyo bileşeni tamamlanan istekleri buradan dinler. */
export function onSongRequest(cb: (r: SongRequest) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Gelen veri paketi şarkı isteğine aitse işler.
 * Dosya tamamlandığında dinleyicilere bildirir.
 * @returns paket bu modüle aitse true
 */
export function ingestSongPacket(peerId: string, data: unknown): boolean {
  const p = data as SongMetaPayload | SongChunkPayload;
  if (p?.type === "song-meta") {
    const meta = p as SongMetaPayload;
    if (meta.size > MAX_SONG_BYTES || meta.chunks <= 0) return true;
    pending.set(meta.id, { meta, parts: new Array(meta.chunks), got: 0 });
    return true;
  }
  if (p?.type === "song-chunk") {
    const c = p as SongChunkPayload;
    const item = pending.get(c.id);
    if (!item) return true;
    if (!item.parts[c.i]) {
      item.parts[c.i] = b64ToU8(c.b);
      item.got += 1;
    }
    if (item.got >= item.meta.chunks) {
      pending.delete(c.id);
      const blob = new Blob(item.parts.filter(Boolean) as unknown as BlobPart[], {
        type: item.meta.mime || "audio/mpeg",
      });
      const req: SongRequest = {
        id: item.meta.id,
        title: item.meta.title,
        rider: item.meta.rider,
        stopName: item.meta.stopName ?? null,
        url: URL.createObjectURL(blob),
        peerId,
        ts: Date.now(),
      };
      // Bağlantı kopsa/sayfa yenilense bile istek kaybolmasın diye kalıcı depoya yaz.
      void saveSong({
        id: req.id,
        title: req.title,
        rider: req.rider,
        stopName: req.stopName,
        peerId: req.peerId,
        ts: req.ts,
        blob,
      });
      listeners.forEach((l) => l(req));
    }
    return true;
  }
  return false;
}

/** "1.DURAK" → "1. durak yolcusu" gibi okunabilir anons ifadesi. */
export function riderLabel(r: Pick<SongRequest, "rider" | "stopName">): string {
  if (r.rider) return r.rider;
  const s = r.stopName?.trim();
  if (!s) return "Bir yolcumuz";
  const m = /^(\d+)\s*\.?\s*DURAK$/i.exec(s);
  if (m) return `${m[1]}. durak yolcusu`;
  return `${s} yolcusu`;
}

/** Anons metni: "Azra müzik ekliyor" / "1. durak yolcusu müzik ekliyor" */
export function requestAnnouncementText(r: SongRequest): string {
  return `${riderLabel(r)} müzik ekliyor. Elektro Radyo, istek üzerine çalıyor.`;
}
