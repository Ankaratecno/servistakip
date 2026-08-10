import { useEffect, useState } from "react";
import {
  breakSeconds,
  clockOf,
  firstStart,
  fmtDuration,
  lastEnd,
  listDays,
  sessionSeconds,
  totalMovingSeconds,
  type DayLog,
} from "@/lib/journey-log";

/**
 * Sağ üstteki 3 yatay çizgi ("Veriler") menüsü.
 * Hem şoför hem yolcu panelinde aynı bileşen kullanılır; yer kaplamaması için
 * tüm günlük veriler bu kayan panelde toplanır.
 */
export default function DataSheet({
  day,
  history = false,
  onReset,
}: {
  day: DayLog | null;
  history?: boolean;
  onReset?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [past, setPast] = useState<DayLog[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    if (history) void listDays(14).then(setPast);
    return () => clearInterval(t);
  }, [open, history]);

  const now = Date.now() + tick * 0;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Veriler"
        title="Veriler"
        className="flex flex-col items-center gap-1 px-3 py-2 rounded-md border border-border hover:bg-muted/50 transition"
      >
        <span className="flex flex-col gap-[3px]">
          <span className="block w-5 h-[2px] bg-foreground" />
          <span className="block w-5 h-[2px] bg-foreground" />
          <span className="block w-5 h-[2px] bg-foreground" />
        </span>
        <span className="text-[9px] font-mono tracking-widest text-muted-foreground">VERİLER</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[1000] flex justify-end">
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <aside className="relative w-full max-w-md h-full overflow-y-auto bg-card border-l border-border p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="hud-label">Veriler</div>
                <h2 className="text-lg font-bold">Günlük Hareket Kaydı</h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 text-sm"
              >
                Kapat
              </button>
            </div>

            {!day ? (
              <div className="text-sm text-muted-foreground">
                Henüz kayıt yok. Şoför yayına başlayınca burada görünecek.
              </div>
            ) : (
              <DaySection day={day} now={now} live />
            )}

            {day && onReset && (
              <button
                onClick={onReset}
                className="text-xs px-3 py-2 rounded-md border border-border hover:bg-muted/50 self-start"
              >
                Bugünün kaydını sıfırla
              </button>
            )}

            {history && past.filter((d) => d.date !== day?.date).length > 0 && (
              <div className="pt-2 border-t border-border">
                <div className="hud-label mb-2">Geçmiş Günler</div>
                <div className="flex flex-col gap-4">
                  {past
                    .filter((d) => d.date !== day?.date)
                    .map((d) => (
                      <DaySection key={d.date} day={d} now={now} />
                    ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function DaySection({ day, now, live }: { day: DayLog; now: number; live?: boolean }) {
  const start = firstStart(day);
  const end = lastEnd(day);
  const breaks = breakSeconds(day);
  const breakTotal = breaks.reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-md border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-bold font-mono">{day.date}</div>
        {live && <span className="text-[10px] font-mono text-primary">CANLI</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Info label="İlk Hareket" value={start ? clockOf(start) : "—"} />
        <Info label="Son Duruş" value={end ? clockOf(end) : live ? "Devam ediyor" : "—"} />
        <Info label="Toplam Hareket" value={fmtDuration(totalMovingSeconds(day, now))} />
        <Info label="Sefer Sayısı" value={String(day.sessions.length)} />
        <Info label="Mola Süresi" value={fmtDuration(breakTotal)} />
        <Info label="Uğranan Durak" value={String(day.arrivals.length)} />
      </div>

      {day.sessions.length > 0 && (
        <div className="mt-4">
          <div className="hud-label mb-2">Seferler (kontak açık/kapalı)</div>
          <div className="flex flex-col gap-1">
            {day.sessions.map((s, i) => (
              <div
                key={s.start}
                className="flex items-center justify-between text-xs font-mono px-2 py-1.5 rounded border border-border/60"
              >
                <span className="text-muted-foreground">#{i + 1}</span>
                <span>
                  {clockOf(s.start)} → {s.end ? clockOf(s.end) : "…"}
                </span>
                <span className="text-primary">{fmtDuration(sessionSeconds(s, now))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {day.arrivals.length > 0 && (
        <div className="mt-4">
          <div className="hud-label mb-2">Durak Varış Saatleri</div>
          <div className="flex flex-col gap-1">
            {day.arrivals
              .slice()
              .sort((a, b) => a.ts - b.ts)
              .map((a) => (
                <div
                  key={a.stopId}
                  className="flex items-center justify-between text-xs px-2 py-1.5 rounded border border-border/60"
                >
                  <span className="font-semibold truncate mr-2">{a.name}</span>
                  <span className="font-mono text-primary">{clockOf(a.ts)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="hud-label mb-1">{label}</div>
      <div className="font-mono font-bold">{value}</div>
    </div>
  );
}
