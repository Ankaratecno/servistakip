import { useEffect, useRef, useState } from "react";
import {
  emptyStats,
  formatSec,
  loadGuessName,
  loadGuessStats,
  saveGuessName,
  saveGuessStats,
  scoreGuess,
  type GuessBoardRow,
  type GuessScorePayload,
  type GuessStats,
} from "@/lib/guess-game";

interface Props {
  /** Yolcunun takip ettiği durak */
  stopName: string | null;
  /** Servis o durağa vardı mı? (kapıda aşaması) */
  arrived: boolean;
  /** Şoför yayında mı? */
  live: boolean;
  /** Puanı diğer yolculara göndermek için */
  onScore: (p: GuessScorePayload) => void;
  /** Şoförün derlediği ortak sıralama */
  board: GuessBoardRow[];
}

const QUICK = [30, 60, 120, 180, 300];

export default function StopGuessGame({ stopName, arrived, live, onScore, board }: Props) {
  const [name, setName] = useState("");
  const [stats, setStats] = useState<GuessStats>(emptyStats);
  const [guess, setGuess] = useState<number | null>(null);
  const [result, setResult] = useState<{ points: number; errorSec: number; label: string } | null>(
    null,
  );
  const lockedAtRef = useRef(0);
  const resolvedRef = useRef(false);

  useEffect(() => {
    setName(loadGuessName());
    setStats(loadGuessStats());
  }, []);

  // Durak değişince yeni tur
  useEffect(() => {
    setGuess(null);
    setResult(null);
    resolvedRef.current = false;
  }, [stopName]);

  // Servis vardığında tahmini puanla
  useEffect(() => {
    if (!arrived || guess == null || resolvedRef.current) return;
    resolvedRef.current = true;
    const actual = (Date.now() - lockedAtRef.current) / 1000;
    const r = scoreGuess(guess, actual);
    setResult(r);
    const next: GuessStats = {
      points: stats.points + r.points,
      games: stats.games + 1,
      bestErrorSec:
        stats.bestErrorSec == null ? r.errorSec : Math.min(stats.bestErrorSec, r.errorSec),
    };
    setStats(next);
    saveGuessStats(next);
    onScore({
      type: "guess-score",
      name: (name || "Yolcu").slice(0, 16),
      points: r.points,
      errorSec: r.errorSec,
      stopName: stopName ?? "-",
      ts: Date.now(),
    });
  }, [arrived, guess]);

  const lock = (sec: number) => {
    lockedAtRef.current = Date.now();
    resolvedRef.current = false;
    setResult(null);
    setGuess(sec);
  };

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="hud-label">Durak Tahmini</div>
        <span className="text-xs font-mono text-muted-foreground">{stats.points} puan</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {stopName
          ? `“${stopName}” durağına servis kaç saniyede varır? Tahminini kilitle, varışta puanını al.`
          : "Önce takip edeceğin durağı seç."}
      </p>

      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          saveGuessName(e.target.value);
        }}
        placeholder="Takma adın (sıralamada görünür)"
        maxLength={16}
        className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />

      {guess == null ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {QUICK.map((s) => (
            <button
              key={s}
              disabled={!stopName || !live}
              onClick={() => lock(s)}
              className="py-2 rounded-md border border-border text-sm font-semibold hover:bg-muted/50 transition disabled:opacity-40"
            >
              {formatSec(s)}
            </button>
          ))}
          <button
            disabled={!stopName || !live}
            onClick={() => {
              const v = window.prompt("Tahminin kaç saniye?", "90");
              const n = Number(v);
              if (Number.isFinite(n) && n > 0 && n < 7200) lock(Math.round(n));
            }}
            className="py-2 rounded-md border border-dashed border-border text-sm font-semibold hover:bg-muted/50 transition disabled:opacity-40"
          >
            Kendim yazayım
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-border p-3">
          <div className="text-sm">
            Tahminin: <span className="font-bold">{formatSec(guess)}</span>
          </div>
          {result ? (
            <div className="mt-2 text-sm">
              <span className="font-bold text-primary">{result.label}</span> · sapma{" "}
              {result.errorSec} sn · <span className="font-bold">+{result.points} puan</span>
              <button
                onClick={() => {
                  setGuess(null);
                  setResult(null);
                }}
                className="mt-3 w-full py-2 rounded-md border border-border text-sm font-semibold hover:bg-muted/50 transition"
              >
                Yeni tahmin
              </button>
            </div>
          ) : (
            <div className="mt-1 text-xs text-muted-foreground">
              Servis durağa varınca sonuç açıklanacak. Kilit bozulmasın diye tahminini
              değiştiremezsin.
            </div>
          )}
        </div>
      )}

      {!live && (
        <p className="mt-3 text-xs text-muted-foreground">
          Şoför yayına başlayınca tahmin yapabilirsin.
        </p>
      )}

      <div className="mt-4 pt-3 border-t border-border">
        <div className="hud-label mb-2">Servistekiler · Sıralama</div>
        {board.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Henüz puan yok. İlk tahmini yapan listeyi açar.
          </p>
        ) : (
          <ul className="space-y-1">
            {board.map((r, i) => (
              <li key={r.name + i} className="flex justify-between text-sm">
                <span>
                  {i + 1}. {r.name}
                </span>
                <span className="font-mono text-muted-foreground">
                  {r.points} p · {r.games} tur
                </span>
              </li>
            ))}
          </ul>
        )}
        {stats.games > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Senin geçmişin: {stats.games} tur · en iyi sapma {stats.bestErrorSec} sn
          </p>
        )}
      </div>
    </div>
  );
}
