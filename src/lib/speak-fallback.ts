// Sunucu destekli TTS yoksa (ör. GitHub Pages statik yayını) anonsu
// cihazın kendi konuşma sentezleyicisiyle söyletiriz.

export function canSpeakLocally(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Metni Türkçe sesle okur; bitince (veya 15 sn sonra) resolve olur. */
export function speakLocally(text: string): Promise<void> {
  if (!canSpeakLocally()) return Promise.reject(new Error("no-speech"));
  return new Promise<void>((resolve) => {
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "tr-TR";
      const tr = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith("tr"));
      if (tr) u.voice = tr;
      u.rate = 1.02;
      u.pitch = 1;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      u.onend = finish;
      u.onerror = finish;
      window.setTimeout(finish, 15000);
      synth.speak(u);
    } catch {
      resolve();
    }
  });
}
