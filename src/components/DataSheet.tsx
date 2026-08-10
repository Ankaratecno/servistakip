import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
 * Hem şoför hem yolcu panelinde aynı bileşen kullanılır; açıldığında
 * yukarıdan aşağı tam ekran açılır ve tüm günlük veriler burada toplanır.
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
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    if (history) void listDays(14).then(setPast);
    return () => clearInterval(t);
  }, [open, history]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[1000] flex flex-col animate-in slide-in-from-top duration-300">
            <div className="absolute inset-0 bg-background" />

            <div className="relative flex flex-col h-full">
              {/* üst bar */}
              <header className="shrink-0 border-b border-border bg-card/60 backdrop-blur">
                <div className="max-w-3xl mx-auto grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-4">
                  <div className="min-w-0">
                    <div className="hud-label">Veriler</div>
                    <h2 className="truncate text-xl font-black tracking-tight">
                      Günlük Hareket Kaydı
                    </h2>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="shrink-0 px-4 py-2 rounded-lg border border-border hover:bg-muted/50 text-sm font-semibold"
                  >
                    Kapat
                  </button>
                </div>
              </header>

              {/* içerik */}
              <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-4 py-5 flex flex-col gap-5">
                  {!day ? (
                    <div className="rounded-xl border border-dashed border-border p-10 text-center">
                      <div className="text-3xl mb-2">📭</div>
                      <div className="text-sm text-muted-foreground">
                        Henüz kayıt yok. Şoför yayına başlayınca burada görünecek.
                      </div>
                    </div>
                  ) : (
                    <DaySection day={day} now={now} live />
                  )}

                  {history && past.filter((d) => d.date !== day?.date).length > 0 && (
                    <div className="pt-1">
                      <div className="hud-label mb-3">Geçmiş Günler</div>
                      <div className="flex flex-col gap-4">
                        {past
                          .filter((d) => d.date !== day?.date)
                          .map((d) => (
                            <DaySection key={d.date} day={d} now={now} />
                          ))}
                      </div>
                    </div>
                  )}

                  {onReset && (
                    <div className="pt-2 pb-8 border-t border-border">
                      {!confirm ? (
                        <button
                          onClick={() => setConfirm(true)}
                          className="w-full sm:w-auto text-sm px-4 py-2.5 rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 font-semibold"
                        >
                          Bugünün kaydını sıfırla
                        </button>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-sm text-muted-foreground">Emin misin?</span>
                          <button
                            onClick={() => {
                              onReset();
                              setConfirm(false);
                            }}
                            className="text-sm px-4 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-semibold"
                          >
                            Evet, sıfırla
                          </button>
                          <button
                            onClick={() => setConfirm(false)}
                            className="text-sm px-4 py-2.5 rounded-lg border border-border hover:bg-muted/50"
                          >
                            Vazgeç
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function DaySection({ day, now, live }: { day: DayLog; now: number; live?: boolean }) {
  const start = firstStart(day);
  const end = lastEnd(day);
  const breaks = breakSeconds(day);
  const breakTotal = breaks.reduce((a, b) => a + b, 0);
  const km = (day.meters ?? 0) / 1000;

  return (
    <section className="rounded-2xl border border-border bg-card/60 overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <div className="truncate font-mono font-bold">{day.date}</div>
        {live && (
          <span className="shrink-0 inline-flex items-center gap-2 text-[10px] font-mono tracking-widest text-primary">
            <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
            CANLI
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border">
        <Info label="İlk Hareket" value={start ? clockOf(start) : "—"} />
        <Info label="Son Duruş" value={end ? clockOf(end) : live ? "Devam ediyor" : "—"} />
        <Info label="Toplam Hareket" value={fmtDuration(totalMovingSeconds(day, now))} />
        <Info label="Sefer Sayısı" value={String(day.sessions.length)} />
        <Info label="Mola Süresi" value={fmtDuration(breakTotal)} />
        <Info label="Uğranan Durak" value={String(day.arrivals.length)} />
        <Info label="Mesafe" value={`${km.toFixed(1)} km`} />
        <Info label="Sürüş Süresi" value={fmtDuration(day.drivingSeconds ?? 0)} />
        <Info
          label="Rölanti"
          value={fmtDuration(Math.max(0, totalMovingSeconds(day, now) - (day.drivingSeconds ?? 0)))}
        />
      </div>

      {day.sessions.length > 0 && (
        <div className="p-4">
          <div className="hud-label mb-2">Seferler (kontak açık/kapalı)</div>
          <div className="flex flex-col gap-1.5">
            {day.sessions.map((s, i) => (
              <div
                key={s.start}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-xs font-mono px-3 py-2 rounded-lg border border-border/60 bg-background/40"
              >
                <span className="text-muted-foreground">#{i + 1}</span>
                <span className="truncate">
                  {clockOf(s.start)} → {s.end ? clockOf(s.end) : "…"}
                </span>
                <span className="text-primary font-bold">
                  {fmtDuration(sessionSeconds(s, now))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {day.arrivals.length > 0 && (
        <div className="px-4 pb-4">
          <div className="hud-label mb-2">Durak Varış Saatleri</div>
          <div className="flex flex-col gap-1.5">
            {day.arrivals
              .slice()
              .sort((a, b) => a.ts - b.ts)
              .map((a, i) => (
                <div
                  key={a.stopId}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-xs px-3 py-2 rounded-lg border border-border/60 bg-background/40"
                >
                  <span className="shrink-0 w-5 h-5 grid place-items-center rounded-full bg-primary/15 text-primary font-mono text-[10px]">
                    {i + 1}
                  </span>
                  <span className="font-semibold truncate">{a.name}</span>
                  <span className="font-mono text-primary">{clockOf(a.ts)}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="hud-label mb-1">{label}</div>
      <div className="font-mono font-bold truncate">{value}</div>
    </div>
  );
}
