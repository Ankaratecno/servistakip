// Durak tahmini oyunu: yolcu "kaç saniyede varır?" der, gerçek varışla karşılaştırılır.

export interface GuessScorePayload {
  type: "guess-score";
  /** Yolcunun takma adı (boşsa "Yolcu") */
  name: string;
  /** Bu turda kazanılan puan */
  points: number;
  /** Tahmin sapması (saniye) */
  errorSec: number;
  stopName: string;
  ts: number;
}

export interface GuessBoardRow {
  name: string;
  points: number;
  games: number;
  ts: number;
}

export interface GuessBoardPayload {
  type: "guess-board";
  rows: GuessBoardRow[];
  ts: number;
}

export interface GuessStats {
  points: number;
  games: number;
  /** En küçük sapma (saniye) */
  bestErrorSec: number | null;
}

const KEY = "acrob-guess-stats";

export const emptyStats: GuessStats = { points: 0, games: 0, bestErrorSec: null };

export function loadGuessStats(): GuessStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStats;
    const p = JSON.parse(raw) as Partial<GuessStats>;
    return {
      points: Number(p.points) || 0,
      games: Number(p.games) || 0,
      bestErrorSec: typeof p.bestErrorSec === "number" ? p.bestErrorSec : null,
    };
  } catch {
    return emptyStats;
  }
}

export function saveGuessStats(s: GuessStats) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadGuessName(): string {
  try {
    return localStorage.getItem("acrob-guess-name") ?? "";
  } catch {
    return "";
  }
}

export function saveGuessName(name: string) {
  try {
    localStorage.setItem("acrob-guess-name", name);
  } catch {
    /* ignore */
  }
}

/** Sapmaya göre puan: tam isabet 100, her saniye 4 puan düşer. */
export function scoreGuess(guessSec: number, actualSec: number) {
  const errorSec = Math.abs(Math.round(actualSec) - Math.round(guessSec));
  const points = Math.max(0, 100 - errorSec * 4);
  const label =
    errorSec <= 3
      ? "Tam isabet!"
      : errorSec <= 10
        ? "Çok iyi tahmin"
        : errorSec <= 30
          ? "Fena değil"
          : "Bir dahaki sefere";
  return { errorSec, points, label };
}

export function mergeBoard(rows: GuessBoardRow[], row: GuessBoardRow, key: string) {
  const next = new Map<string, GuessBoardRow>();
  rows.forEach((r) => next.set(r.name.toLowerCase(), r));
  const k = key.toLowerCase();
  const cur = next.get(k);
  next.set(k, {
    name: row.name,
    points: (cur?.points ?? 0) + row.points,
    games: (cur?.games ?? 0) + 1,
    ts: row.ts,
  });
  return [...next.values()].sort((a, b) => b.points - a.points).slice(0, 20);
}

export function formatSec(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m} dk ${sec} sn` : `${sec} sn`;
}
