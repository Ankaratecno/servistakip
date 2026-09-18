// Radyo anons kuyruğu — durak anonsları jingle gibi yayına girer.
// Şoför paneli (veya ileride otomatik GPS mantığı) buraya anons bırakır,
// DriverRadio uygun anda (şarkı bitince ya da yayın boşsa hemen) çalar.
// Ses yayın hattından geçtiği için hem şoförde hem yolcuların radyosunda duyulur.

export interface RadioAnnouncement {
  /** Aynı anonsun iki kez kuyruğa girmemesi için benzersiz kimlik */
  id: string;
  /** Sırayla çalınacak mp3 adresleri (ana anons + espri gibi) */
  urls: string[];
  /** Şoför ekranında görünen etiket */
  label: string;
  /** Daha sakin jingle dokusu (saat anonsu gibi) */
  soft?: boolean;
  /** Şarkının bitmesini bekleme, ilk fırsatta çal */
  immediate?: boolean;
}

type Listener = (a: RadioAnnouncement) => void;

const listeners = new Set<Listener>();
/** Dinleyici (radyo) henüz bağlanmadıysa anonslar burada bekler. */
const pending: RadioAnnouncement[] = [];

export function onRadioAnnouncement(fn: Listener): () => void {
  listeners.add(fn);
  while (pending.length) {
    const a = pending.shift()!;
    try {
      fn(a);
    } catch {
      /* ignore */
    }
  }
  return () => listeners.delete(fn);
}

export function queueRadioAnnouncement(a: RadioAnnouncement) {
  if (listeners.size === 0) {
    if (!pending.some((p) => p.id === a.id)) pending.push(a);
    return;
  }
  listeners.forEach((fn) => {
    try {
      fn(a);
    } catch {
      /* ignore */
    }
  });
}
