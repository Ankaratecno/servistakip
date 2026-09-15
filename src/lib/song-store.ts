// Kopma sonrası devam: yolcudan gelen istek şarkıları ve çalma anı
// tarayıcının IndexedDB deposuna yazılır. Sayfa yenilense, bağlantı kopsa
// bile parça kaldığı yerden devam eder; çalınan/silinen kayıt temizlenir.

const DB_NAME = "acrob-songs";
const SONGS = "songs";
const PROGRESS = "progress";
const PLAYED = "played";
const PROGRESS_KEY = "last";
const VERSION = 2;

/** Bu süreden eski kayıtlar açılışta temizlenir (dünkü sefer). */
export const SONG_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Kaldığı yerden devam ederken bu kadar geri sarılır. */
export const RESUME_REWIND_SEC = 2;

export interface StoredSong {
  id: string;
  title: string;
  rider: string | null;
  stopName: string | null;
  peerId: string;
  ts: number;
  blob: Blob;
}

export interface SongProgress {
  id: string;
  /** Saniye cinsinden son not edilen an */
  position: number;
  ts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SONGS)) db.createObjectStore(SONGS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS);
      if (!db.objectStoreNames.contains(PLAYED)) db.createObjectStore(PLAYED, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSong(song: StoredSong): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(SONGS, "readwrite").objectStore(SONGS).put(song);
  } catch {
    /* ignore */
  }
}

export async function listSongs(): Promise<StoredSong[]> {
  try {
    const db = await openDb();
    const all = await new Promise<StoredSong[]>((resolve) => {
      const req = db.transaction(SONGS, "readonly").objectStore(SONGS).getAll();
      req.onsuccess = () => resolve((req.result as StoredSong[]) ?? []);
      req.onerror = () => resolve([]);
    });
    const now = Date.now();
    const fresh = all.filter((s) => now - s.ts <= SONG_MAX_AGE_MS);
    all.filter((s) => now - s.ts > SONG_MAX_AGE_MS).forEach((s) => void deleteSong(s.id));
    return fresh.sort((a, b) => a.ts - b.ts);
  } catch {
    return [];
  }
}

export async function deleteSong(id: string): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(SONGS, "readwrite").objectStore(SONGS).delete(id);
  } catch {
    /* ignore */
  }
}

export async function saveProgress(p: SongProgress): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(PROGRESS, "readwrite").objectStore(PROGRESS).put(p, PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadProgress(): Promise<SongProgress | null> {
  try {
    const db = await openDb();
    const p = await new Promise<SongProgress | null>((resolve) => {
      const req = db.transaction(PROGRESS, "readonly").objectStore(PROGRESS).get(PROGRESS_KEY);
      req.onsuccess = () => resolve((req.result as SongProgress) ?? null);
      req.onerror = () => resolve(null);
    });
    if (!p) return null;
    if (Date.now() - p.ts > SONG_MAX_AGE_MS) return null;
    return p;
  } catch {
    return null;
  }
}

export async function clearProgress(): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(PROGRESS, "readwrite").objectStore(PROGRESS).delete(PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Çalınan (veya elle silinen) istek kimlikleri. Aynı parçanın dönüp dolaşıp
 * tekrar sıraya girmesini engeller; kayıt silinse bile işaret kalır.
 */
interface PlayedMark {
  id: string;
  ts: number;
}

export async function markPlayed(id: string): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(PLAYED, "readwrite")
      .objectStore(PLAYED)
      .put({ id, ts: Date.now() } satisfies PlayedMark);
  } catch {
    /* ignore */
  }
}

export async function listPlayedIds(): Promise<string[]> {
  try {
    const db = await openDb();
    const all = await new Promise<PlayedMark[]>((resolve) => {
      const req = db.transaction(PLAYED, "readonly").objectStore(PLAYED).getAll();
      req.onsuccess = () => resolve((req.result as PlayedMark[]) ?? []);
      req.onerror = () => resolve([]);
    });
    const now = Date.now();
    const fresh = all.filter((m) => now - m.ts <= SONG_MAX_AGE_MS);
    const stale = all.filter((m) => now - m.ts > SONG_MAX_AGE_MS);
    if (stale.length > 0) {
      try {
        const store = db.transaction(PLAYED, "readwrite").objectStore(PLAYED);
        stale.forEach((m) => store.delete(m.id));
      } catch {
        /* ignore */
      }
    }
    return fresh.map((m) => m.id);
  } catch {
    return [];
  }
}
