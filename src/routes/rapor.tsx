import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { SERVICE_INFO } from "@/lib/service-config";
import {
  clearAllDays,
  clockOf,
  clockOfSeconds,
  dayReport,
  daysToCsv,
  downloadFile,
  fmtDuration,
  listDays,
  pruneDays,
  punctuality,
  todayKey,
  type DayLog,
  type DayReport,
  type PunctualityReport,
} from "@/lib/journey-log";

export const Route = createFileRoute("/rapor")({
  head: () => ({
    meta: [
      { title: "Haftalık Sürüş Raporu – Acrob Elektroland" },
      {
        name: "description",
        content:
          "Servis aracının haftalık sürüş raporu: rölanti süresi, ortalama hız, sefer sayısı ve durak düzenlilik skoru.",
      },
      { property: "og:title", content: "Haftalık Sürüş Raporu – Acrob Elektroland" },
      {
        property: "og:description",
        content: "Rölanti, ortalama hız ve düzenlilik skoru ile kurumsal servis raporu.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ClientOnly
      fallback={
        <div className="min-h-screen flex items-center justify-center text-muted-foreground">
          Yükleniyor...
        </div>
      }
    >
      <ReportPage />
    </ClientOnly>
  ),
});

type Range = 1 | 7 | 30;

function ReportPage() {
  const [days, setDays] = useState<DayLog[]>([]);
  const [range, setRange] = useState<Range>(7);
  const [confirmReset, setConfirmReset] = useState(false);
  const [openStop, setOpenStop] = useState<string | null>(null);

  const reload = (r: Range) => void listDays(r).then(setDays);

  useEffect(() => {
    // 30 günden eski kayıtlar kendiliğinden temizlenir
    void pruneDays(30).then(() => reload(range));
  }, [range]);

  const reports: DayReport[] = days.map((d) => dayReport(d));
  const punct: PunctualityReport = punctuality(days);

  const totalKm = reports.reduce((a, r) => a + r.km, 0);
  const totalIgnition = reports.reduce((a, r) => a + r.ignitionSeconds, 0);
  const totalDriving = reports.reduce((a, r) => a + r.drivingSeconds, 0);
  const totalIdle = reports.reduce((a, r) => a + r.idleSeconds, 0);
  const avgSpeed = totalDriving > 60 ? totalKm / (totalDriving / 3600) : 0;
  const idlePct = totalIgnition > 0 ? (totalIdle / totalIgnition) * 100 : 0;

  const label = range === 1 ? "gunluk" : range === 7 ? "haftalik" : "30-gun";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur print:hidden">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-wrap items-center gap-3">
          <Link to="/driver" className="hud-label hover:text-primary">
            ← Şoför Paneli
          </Link>
          <div className="flex-1 min-w-[120px] text-center">
            <h1 className="text-lg font-bold">SÜRÜŞ RAPORU</h1>
          </div>
          <select
            value={range}
            onChange={(e) => setRange(Number(e.target.value) as Range)}
            className="bg-input border border-border rounded-md px-2 py-1.5 text-sm"
            aria-label="Rapor aralığı"
          >
            <option value={1}>Günlük</option>
            <option value={7}>Haftalık (7 gün)</option>
            <option value={30}>30 gün</option>
          </select>
          <button
            onClick={() => downloadFile(`servis-rapor-${label}-${todayKey()}.csv`, daysToCsv(days))}
            disabled={days.length === 0}
            className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground font-semibold disabled:opacity-40"
          >
            CSV indir
          </button>
          <button
            onClick={() => window.print()}
            disabled={days.length === 0}
            className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/50 disabled:opacity-40"
          >
            PDF / Yazdır
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 flex flex-col gap-4">
        <div className="panel p-5">
          <div className="hud-label mb-1">Servis</div>
          <div className="font-bold">
            {SERVICE_INFO.vehicle} · {SERVICE_INFO.plate}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {days.length} günlük kayıt · en fazla 30 gün saklanır
          </div>
        </div>

        {days.length === 0 ? (
          <div className="panel p-8 text-center text-muted-foreground">
            Henüz kayıt yok. Şoför panelinde yayın başlatıldığında günlük veriler burada birikir.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Metric label="Toplam KM" value={totalKm.toFixed(1)} />
              <Metric label="Ortalama Hız" value={`${Math.round(avgSpeed)} km/s`} />
              <Metric label="Rölanti Süresi" value={fmtDuration(totalIdle)} />
              <Metric label="Rölanti Oranı" value={`%${Math.round(idlePct)}`} />
            </div>

            <div className="panel p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="hud-label">Düzenlilik Skoru</div>
                <div className="text-3xl font-mono font-bold text-primary">{punct.score}</div>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${punct.score}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Her durak kendi ortalama varış saatine göre puanlanır: ≤2 dk sapma 100 · ≤5 dk 95 ·
                ≤10 dk 85 · ≤15 dk 70 · ≤30 dk 40 · üzeri 0 puan. Genel skor durak puanlarının
                ortalamasıdır.
              </p>

              {punct.stops.length > 0 && (
                <div className="mt-4 flex flex-col gap-1">
                  {punct.stops.map((s) => (
                    <div key={s.stopId} className="rounded border border-border/60">
                      <button
                        onClick={() => setOpenStop(openStop === s.stopId ? null : s.stopId)}
                        className="w-full grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs px-3 py-2 text-left hover:bg-muted/40"
                      >
                        <span className="font-semibold truncate">{s.name}</span>
                        <span className="font-mono text-muted-foreground whitespace-nowrap">
                          ORT. {clockOfSeconds(s.medianSeconds)} · ±
                          {fmtDuration(s.deviationSeconds)} · BEKLEME{" "}
                          {fmtDuration(s.avgDwellSeconds)} · {s.samples} gün
                        </span>
                        <span className="font-mono font-bold text-primary">
                          {s.samples >= 2 ? s.score : "—"}
                        </span>
                      </button>
                      {openStop === s.stopId && (
                        <div className="border-t border-border/60 p-3 flex flex-col gap-1">
                          {s.days.map((d) => (
                            <div
                              key={d.date}
                              className="grid grid-cols-4 gap-2 text-[11px] font-mono"
                            >
                              <span>{d.date}</span>
                              <span>{clockOfSeconds(d.seconds)}</span>
                              <span className="text-muted-foreground">
                                bekleme {fmtDuration(d.dwellSeconds)}
                              </span>
                              <span className="text-primary font-bold text-right">
                                {d.score} puan
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="panel p-5">
              <div className="hud-label mb-3">Günlük Döküm</div>
              <div className="flex flex-col gap-3">
                {reports.map((r) => (
                  <div key={r.date} className="rounded-md border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-bold">{r.date}</span>
                      <span className="text-xs font-mono text-muted-foreground">
                        İLK HAREKET {r.firstStart ? clockOf(r.firstStart) : "—"}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <Cell label="KM" value={r.km.toFixed(1)} />
                      <Cell label="Ort. Hız" value={`${Math.round(r.avgSpeedKmh)} km/s`} />
                      <Cell label="Rölanti" value={fmtDuration(r.idleSeconds)} />
                      <Cell label="Sefer" value={String(r.trips)} />
                      <Cell label="Kontak Açık" value={fmtDuration(r.ignitionSeconds)} />
                      <Cell label="Hareket" value={fmtDuration(r.drivingSeconds)} />
                      <Cell label="Mola" value={fmtDuration(r.breakSeconds)} />
                      <Cell label="Durak" value={String(r.arrivals.length)} />
                    </div>
                    {r.arrivals.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {r.arrivals
                          .slice()
                          .sort((a, b) => a.ts - b.ts)
                          .map((a) => (
                            <span
                              key={a.stopId}
                              className="text-[11px] font-mono px-2 py-1 rounded border border-border/60"
                            >
                              {a.name}: {clockOf(a.ts)} · bekleme {fmtDuration(a.dwellSeconds ?? 0)}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="panel p-5 print:hidden">
              <div className="hud-label mb-3">Kayıtları Sıfırla</div>
              {!confirmReset ? (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="text-sm px-4 py-2.5 rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 font-semibold"
                >
                  Tüm rapor kayıtlarını sıfırla
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    Tüm günlerin verisi silinecek. Emin misin?
                  </span>
                  <button
                    onClick={() => {
                      void clearAllDays().then(() => {
                        setConfirmReset(false);
                        reload(range);
                      });
                    }}
                    className="text-sm px-4 py-2.5 rounded-lg bg-destructive text-destructive-foreground font-semibold"
                  >
                    Evet, sıfırla
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    className="text-sm px-4 py-2.5 rounded-lg border border-border hover:bg-muted/50"
                  >
                    Vazgeç
                  </button>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Sıfırlamadan önce CSV indirmen önerilir; silinen veriler geri gelmez.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-5">
      <div className="hud-label mb-1">{label}</div>
      <div className="text-2xl font-mono font-bold text-primary">{value}</div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="hud-label mb-1">{label}</div>
      <div className="font-mono font-bold">{value}</div>
    </div>
  );
}
