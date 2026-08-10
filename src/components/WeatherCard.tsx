import { useEffect, useRef, useState } from "react";
import { describeCode, driveHint, fetchWeather, type WeatherNow } from "@/lib/weather";

interface Props {
  /** Servis aracının anlık konumu */
  position: { lat: number; lng: number } | null;
  /** Panel başlığı altındaki küçük açıklama */
  subtitle?: string;
}

const REFRESH_MS = 10 * 60 * 1000; // 10 dk
const MOVE_THRESHOLD = 0.02; // ~2 km değişince yeniden sorgula

export default function WeatherCard({ position, subtitle }: Props) {
  const [weather, setWeather] = useState<WeatherNow | null>(null);
  const [loading, setLoading] = useState(false);
  const lastRef = useRef<{ lat: number; lng: number; ts: number } | null>(null);

  useEffect(() => {
    if (!position) return;
    const { lat, lng } = position;
    const last = lastRef.current;
    const moved =
      !last || Math.abs(last.lat - lat) > MOVE_THRESHOLD || Math.abs(last.lng - lng) > MOVE_THRESHOLD;
    const stale = !last || Date.now() - last.ts > REFRESH_MS;
    if (!moved && !stale) return;

    let cancelled = false;
    lastRef.current = { lat, lng, ts: Date.now() };
    setLoading(true);
    void fetchWeather(lat, lng).then((w) => {
      if (cancelled) return;
      setLoading(false);
      if (w) setWeather(w);
    });
    return () => {
      cancelled = true;
    };
  }, [position?.lat, position?.lng]);

  // Konum sabit kalsa bile periyodik tazeleme
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = lastRef.current;
      if (!p) return;
      void fetchWeather(p.lat, p.lng).then((w) => {
        if (w) {
          setWeather(w);
          lastRef.current = { lat: p.lat, lng: p.lng, ts: Date.now() };
        }
      });
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const desc = weather ? describeCode(weather.code, weather.isDay) : null;
  const hint = weather ? driveHint(weather) : null;

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="hud-label">Servis Konumu Hava Durumu</div>
        <span className="text-[11px] font-mono text-muted-foreground">
          {weather ? new Date(weather.ts).toLocaleTimeString("tr-TR") : loading ? "…" : "—"}
        </span>
      </div>

      {!position ? (
        <div className="text-sm text-muted-foreground">
          Servis konumu geldiğinde güzergâhın hava durumu burada görünür.
        </div>
      ) : !weather ? (
        <div className="text-sm text-muted-foreground">
          {loading ? "Hava durumu alınıyor…" : "Hava durumu verisi alınamadı."}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <div className="text-5xl leading-none" aria-hidden>
              {desc?.icon}
            </div>
            <div>
              <div className="text-4xl font-mono font-bold text-primary">
                {Math.round(weather.tempC)}
                <span className="text-sm text-muted-foreground ml-1">°C</span>
              </div>
              <div className="text-sm font-semibold">{desc?.label}</div>
              <div className="text-[11px] font-mono text-muted-foreground">
                HİSSEDİLEN {Math.round(weather.feelsC)}°C
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4">
            <div>
              <div className="hud-label mb-1">Rüzgâr</div>
              <div className="font-mono font-bold">{Math.round(weather.windKmh)} km/s</div>
            </div>
            <div>
              <div className="hud-label mb-1">Nem</div>
              <div className="font-mono font-bold">{Math.round(weather.humidity)}%</div>
            </div>
            <div>
              <div className="hud-label mb-1">Yağış</div>
              <div className="font-mono font-bold">{weather.precipMm.toFixed(1)} mm</div>
            </div>
          </div>

          {hint && (
            <div className="mt-3 rounded-md border border-border p-3 text-sm font-semibold">
              {hint}
            </div>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground mt-3">
        {subtitle ?? "Open-Meteo · anahtarsız ve ücretsiz · 10 dakikada bir güncellenir."}
      </p>
    </div>
  );
}
