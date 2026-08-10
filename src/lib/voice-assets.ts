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
