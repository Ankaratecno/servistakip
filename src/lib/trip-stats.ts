// Şoför sürüş istatistikleri - IndexedDB'de kalıcı (şoför silene kadar durmaz)
export interface TripStats {
  totalMeters: number;
  movingSeconds: number; // hareket halinde geçen süre
  maxSpeedKmh: number;
  startedAt: number;
  updatedAt: number;
}

const DB_NAME = "acrob-trip-stats";
const STORE = "stats";
const KEY = "current";

export const EMPTY_STATS: TripStats = {
  totalMeters: 0,
  movingSeconds: 0,
  maxSpeedKmh: 0,
  startedAt: Date.now(),
  updatedAt: Date.now(),
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadStats(): Promise<TripStats> {
  try {
    const db = await openDb();
    return await new Promise<TripStats>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as TripStats) ?? { ...EMPTY_STATS });
      req.onerror = () => resolve({ ...EMPTY_STATS });
    });
  } catch {
    return { ...EMPTY_STATS };
  }
}

export async function saveStats(stats: TripStats): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(stats, KEY);
  } catch {
    /* ignore */
  }
}

export async function resetStats(): Promise<TripStats> {
  const fresh: TripStats = { ...EMPTY_STATS, startedAt: Date.now(), updatedAt: Date.now() };
  await saveStats(fresh);
  return fresh;
}

export function avgSpeedKmh(stats: TripStats): number {
  if (stats.movingSeconds < 5) return 0;
  return stats.totalMeters / 1000 / (stats.movingSeconds / 3600) || 0;
}
