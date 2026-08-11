// YAPILACAKLAR3 #31: her ses çalmada yeni AudioContext açmak iOS'ta birkaç
// denemeden sonra sesi tamamen kesiyor. Tüm uygulama tek context paylaşır.

let ctx: AudioContext | null = null;

export function sharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx || ctx.state === "closed") {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** İlk kullanıcı dokunuşunda context'i uyandırmak için. */
export function resumeSharedAudio() {
  const c = sharedAudioContext();
  if (c && c.state === "suspended") void c.resume();
}
