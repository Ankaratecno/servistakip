import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { SERVICE_INFO } from "@/lib/service-config";
import {
  clockOf,
  clockOfSeconds,
  dayReport,
  fmtDuration,
  listDays,
  punctuality,
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

function ReportPage() {
  const [days, setDays] = useState<DayLog[]>([]);
  const [range, setRange] = useState<7 | 14 | 30>(7);

  useEffect(() => {
    void listDays(range).then(setDays);
  }, [range]);

  const reports: DayReport[] = days.map((d) => dayReport(d));
  const punct: PunctualityReport = punctuality(days);

  const totalKm = reports.reduce((a, r) => a + r.km, 0);
  const totalIgnition = reports.reduce((a, r) => a + r.ignitionSeconds, 0);
  const totalDriving = reports.reduce((a, r) => a + r.drivingSeconds, 0);
  const totalIdle = reports.reduce((a, r) => a + r.idleSeconds, 0);
  const avgSpeed = totalDriving > 60 ? totalKm / (totalDriving / 3600) : 0;
  const idlePct = totalIgnition > 0 ? (totalIdle / totalIgnition) * 100 : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/driver" className="hud-label hover:text-primary">
            ← Şoför Paneli
          </Link>
          <div className="flex-1 text-center">
            <h1 className="text-lg font-bold">SÜRÜŞ RAPORU</h1>
          </div>
          <select
            value={range}
            onChange={(e) => setRange(Number(e.target.value) as 7 | 14 | 30)}
            className="bg-input border border-border rounded-md px-2 py-1.5 text-sm"
            aria-label="Rapor aralığı"
          >
            <option value={7}>7 gün</option>
            <option value={14}>14 gün</option>
            <option value={30}>30 gün</option>
          </select>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 flex flex-col gap-4">
        <div className="panel p-5">
          <div className="hud-label mb-1">Servis</div>
          <div className="font-bold">
            {SERVICE_INFO.vehicle} · {SERVICE_INFO.plate}
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
                Duraklara varış saatlerinin günler arası sapması ölçülür. 0 sapma = 100 puan, 15 dk
                ve üzeri sapma = 0 puan.
              </p>

              {punct.stops.length > 0 && (
                <div className="mt-4 flex flex-col gap-1">
                  {punct.stops.map((s) => (
                    <div
                      key={s.stopId}
                      className="flex items-center justify-between text-xs px-3 py-2 rounded border border-border/60"
                    >
                      <span className="font-semibold truncate mr-2">{s.name}</span>
                      <span className="font-mono text-muted-foreground">
                        ORT. {clockOfSeconds(s.medianSeconds)} · ±
                        {fmtDuration(s.deviationSeconds)} · {s.samples} gün
                      </span>
                      <span className="font-mono font-bold text-primary ml-2">
                        {s.samples >= 2 ? s.score : "—"}
                      </span>
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
                  </div>
                ))}
              </div>
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
