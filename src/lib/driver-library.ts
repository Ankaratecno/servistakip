// Şoför çalma listesi kalıcılığı.
// Yolcu istek şarkılarında (song-store.ts) kullanılan mantığın aynısı, ama
// şoförün kendi eklediği dosyalar için: dosyaların kendisi (blob), liste
// sırası, o an çalan parça ve kaldığı saniye cihazın IndexedDB deposunda
// saklanır. Sayfa yenilense, bağlantı kopsa da liste sıfırlanmaz.

const DB_NAME = "acrob-driver-library";
const TRACKS = "tracks";
const STATE = "state";
const STATE_KEY = "last";
const VERSION = 1;

/** Kaldığı yerden devam ederken bu kadar geri sarılır. */
export const LIBRARY_REWIND_SEC = 2;

export interface StoredTrack {
  id: string;
  name: string;
  /** Liste içindeki sıra (0 tabanlı) */
  order: number;
  mime: string;
  ts: number;
  blob: Blob;
}

export interface LibraryState {
  /** O an çalan parçanın kimliği */
  trackId: string | null;
  /** Liste içindeki sırası */
  index: number;
  /** Saniye cinsinden son not edilen an */
  position: number;
  ts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRACKS)) db.createObjectStore(TRACKS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STATE)) db.createObjectStore(STATE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTracks(tracks: StoredTrack[]): Promise<void> {
  if (tracks.length === 0) return;
  try {
    const db = await openDb();
    const store = db.transaction(TRACKS, "readwrite").objectStore(TRACKS);
    tracks.forEach((t) => store.put(t));
  } catch {
    /* kota dolu olabilir */
  }
}

export async function listTracks(): Promise<StoredTrack[]> {
  try {
    const db = await openDb();
    const all = await new Promise<StoredTrack[]>((resolve) => {
      const req = db.transaction(TRACKS, "readonly").objectStore(TRACKS).getAll();
      req.onsuccess = () => resolve((req.result as StoredTrack[]) ?? []);
      req.onerror = () => resolve([]);
    });
    return all.sort((a, b) => a.order - b.order || a.ts - b.ts);
  } catch {
    return [];
  }
}

export async function deleteTrack(id: string): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(TRACKS, "readwrite").objectStore(TRACKS).delete(id);
  } catch {
    /* ignore */
  }
}

export async function clearTracks(): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(TRACKS, "readwrite").objectStore(TRACKS).clear();
    db.transaction(STATE, "readwrite").objectStore(STATE).delete(STATE_KEY);
  } catch {
    /* ignore */
  }
}

/** Liste sırasını yeniden numaralar (silme/ekleme sonrası). */
export async function reorderTracks(ids: string[]): Promise<void> {
  try {
    const db = await openDb();
    const store = db.transaction(TRACKS, "readwrite").objectStore(TRACKS);
    ids.forEach((id, i) => {
      const req = store.get(id);
      req.onsuccess = () => {
        const t = req.result as StoredTrack | undefined;
        if (t) store.put({ ...t, order: i });
      };
    });
  } catch {
    /* ignore */
  }
}

export async function saveLibraryState(state: LibraryState): Promise<void> {
  try {
    const db = await openDb();
    db.transaction(STATE, "readwrite").objectStore(STATE).put(state, STATE_KEY);
  } catch {
    /* ignore */
  }
}

export async function loadLibraryState(): Promise<LibraryState | null> {
  try {
    const db = await openDb();
    return await new Promise<LibraryState | null>((resolve) => {
      const req = db.transaction(STATE, "readonly").objectStore(STATE).get(STATE_KEY);
      req.onsuccess = () => resolve((req.result as LibraryState) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
