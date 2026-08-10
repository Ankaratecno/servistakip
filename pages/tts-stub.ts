// GitHub Pages (statik SPA) build'inde sunucu fonksiyonu çalışmaz.
// @tanstack/react-start'ın sunucu tarafı (AsyncLocalStorage) tarayıcıya girmesin diye
// vite.pages.config.ts bu dosyayı tts.functions yerine alias'lar.
export async function synthAnnouncement(_args: {
  data: { text: string };
}): Promise<{ mp3: string }> {
  throw new Error("Sesli anons yalnızca sunucu destekli sürümde çalışır.");
}
