// 15. madde: Kopma sonrası devam.
// Son geçilen durak IndexedDB'ye yazılır; yayın yeniden başlatılırken şoföre
// "Kaldığım yerden devam et / Baştan başla" seçeneği sunulur.

const DB_NAME = "acrob-resume";
const STORE = "resume";
const KEY = "last";

/** Kayıt bu süreden eskiyse "dünkü sefer" sayılır ve önerilmez. */
export const RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface ResumePoint {
  stopId: string;
  stopName: string;
  /** Durağın tüm liste içindeki sırası (0 tabanlı) */
  index: number;
  ts: number;
}

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

export async function saveResume(point: ResumePoint): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(point, KEY);
  } catch {
    /* ignore */
  }
}

export async function loadResume(): Promise<ResumePoint | null> {
  try {
    const db = await openDb();
    const point = await new Promise<ResumePoint | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as ResumePoint) ?? null);
      req.onerror = () => resolve(null);
    });
    if (!point) return null;
    if (Date.now() - point.ts > RESUME_MAX_AGE_MS) return null;
    return point;
  } catch {
    return null;
  }
}

export async function clearResume(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
  } catch {
    /* ignore */
  }
}
