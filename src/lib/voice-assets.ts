// Önceden üretilmiş radyo anons sesleri.
// Dosyalar public/audio/ içinde gelir; hem sunuculu sürümde hem GitHub Pages'te
// aynı spiker sesi çalar, TTS/sunucu gerekmez.

/** Vite base (GitHub Pages'te /Repo/ olabilir). */
function base(): string {
  const b = import.meta.env.BASE_URL || "/";
  return b.endsWith("/") ? b : `${b}/`;
}

function fileUrl(name: string): string {
  return `${base()}audio/${name}.mp3`;
}

/** Rastgele istasyon jingle sesi (URL). */
export function randomJingleUrl(): string {
  const n = 1 + Math.floor(Math.random() * 3);
  return fileUrl(`jingle-${n}`);
}

/** Verilen saate ait anons sesi (URL). */
export function hourAnnouncementUrl(d = new Date()): string {
  const hh = String(d.getHours()).padStart(2, "0");
  return fileUrl(`saat-${hh}`);
}

/** İstek şarkısı anonsu: "Elektro Radyo, istek üzerine çalıyor." (URL). */
export function requestAnnouncementUrl(): string {
  return fileUrl("istek");
}

// ---------- Karşılama anonsu (1. ve 9. duraktan kalkışta) ----------

/** Cuma günleri özel karşılama sesi çalar. */
export function isFriday(d = new Date()): boolean {
  return d.getDay() === 5;
}

/** "Sayın yolcumuz hoş geldiniz…" (cuma ise önce bu, ardından mübarek cuma anonsu). */
export function welcomeGreetingUrl(d = new Date()): string {
  return fileUrl("karsilama");
}

/** Karşılama paketi: normal gün tek ses; cuma önce karşılama, sonra cuma anonsu. */
export function welcomeGreetingUrls(d = new Date()): string[] {
  return isFriday(d)
    ? [welcomeGreetingUrl(d), fileUrl("karsilama-cuma-sade")]
    : [welcomeGreetingUrl(d)];
}

export function welcomeGreetingLabel(d = new Date()): string {
  return isFriday(d) ? "🕌 HOŞ GELDİNİZ · HAYIRLI CUMALAR" : "👋 HOŞ GELDİNİZ";
}

// ---------- Durak anonsları (statik mp3 — GitHub Pages uyumlu) ----------

/** 25 Saat Fırın'a ~2 dakika kala. */
export function bakery2MinUrl(): string {
  return fileUrl("durak-25saat-2dk");
}

/** 25 Saat Fırın'a ~30 saniye kala (ana anons). */
export function bakery30SecUrl(): string {
  return fileUrl("durak-25saat-30sn");
}

/** Eloktroland (fabrika) varış anonsu. */
export function factoryArrivalUrl(): string {
  return fileUrl("durak-eloktroland-30sn");
}

/** "Servisimiz bugün çalışmayacaktır" hızlı uyarı anonsu. */
export function notTodayUrl(): string {
  return fileUrl("bugun-yokum");
}

/** Hazır durak anons paketleri — kuyruğa olduğu gibi bırakılabilir. */
export const STOP_ANNOUNCEMENTS = {
  bakery2min: { label: "🥐 25 SAAT FIRIN · 2 DK", urls: [bakery2MinUrl] },
  bakeryNear: { label: "🥐 25 SAAT FIRIN", urls: [bakery30SecUrl] },
  factory: { label: "🏭 ELOKTROLAND", urls: [factoryArrivalUrl] },
  notToday: { label: "⚠️ BUGÜN YOKUM", urls: [notTodayUrl] },
} as const;

export type StopAnnouncementKey = keyof typeof STOP_ANNOUNCEMENTS;

/** Hazır paketten anons kuyruğu nesnesi üretir.
 * Durak anonsları zamana bağlıdır (2 dk / 30 sn kala), bu yüzden varsayılan
 * olarak şarkının bitmesini beklemez; müziği kısıp hemen üstüne çalar. */
export function stopAnnouncement(key: StopAnnouncementKey, immediate = true) {
  const item = STOP_ANNOUNCEMENTS[key];
  return {
    id: `${key}-${Date.now()}`,
    label: item.label,
    urls: item.urls.map((f) => f()),
    immediate,
  };
}
