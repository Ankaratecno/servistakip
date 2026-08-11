// YAPILACAKLAR3 #48: PWA / çevrimdışı kabuk yardımcıları.
// - Service worker kaydı (yalnızca tarayıcıda, üretim benzeri ortamlarda)
// - Son bilinen servis durumunun yerel önbelleği (tünelde sayfa yenilenirse
//   en azından son konum/hız/güncelleme saati görünsün)

const LAST_KNOWN_KEY = "acrob-last-known";

export interface LastKnownState {
  lat: number;
  lng: number;
  speedKmh: number;
  ts: number;
}

export function registerServiceWorker() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  // Vite geliştirme sunucusunda SW modül grafiğini bozabilir → sadece derlemede
  if (import.meta.env.DEV) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* çevrimdışı kabuk yoksa uygulama yine de çalışır */
    });
  });
}

export function saveLastKnown(state: LastKnownState) {
  try {
    localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify(state));
  } catch {
    /* kota dolu olabilir */
  }
}

export function readLastKnown(): LastKnownState | null {
  try {
    const raw = localStorage.getItem(LAST_KNOWN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastKnownState>;
    if (typeof v.lat !== "number" || typeof v.lng !== "number" || typeof v.ts !== "number") {
      return null;
    }
    return { lat: v.lat, lng: v.lng, speedKmh: Number(v.speedKmh) || 0, ts: v.ts };
  } catch {
    return null;
  }
}
