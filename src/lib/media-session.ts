// Araç ekranı / Bluetooth (AVRCP) için parça bilgisi. Media Session API,
// tarayıcıdan işletim sistemine "şu an çalan" bilgisini geçirir; araç teybi
// bunu okuyup ekranda gösterir.

interface MediaSessionLike {
  metadata: unknown;
  playbackState?: "none" | "paused" | "playing";
  setActionHandler?: (action: string, handler: (() => void) | null) => void;
}

function session(): MediaSessionLike | null {
  if (typeof navigator === "undefined") return null;
  const s = (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession;
  return s ?? null;
}

// Araç teybinde SADECE çalan parçanın adı görünsün: istasyon/uygulama adı
// (ör. "Acrob Servis Radyosu") artist/album alanlarına yazılmaz.
export function setNowPlaying(title: string | null) {
  const s = session();
  if (!s) return;
  const MM = (window as unknown as { MediaMetadata?: new (i: Record<string, unknown>) => unknown })
    .MediaMetadata;
  if (!MM) return;
  try {
    s.metadata = title ? new MM({ title }) : null;
  } catch {
    /* ignore */
  }
}

export function setPlaybackState(playing: boolean) {
  const s = session();
  if (!s) return;
  try {
    s.playbackState = playing ? "playing" : "paused";
  } catch {
    /* ignore */
  }
}

/** Direksiyon/teyp tuşları (önceki-sonraki-oynat) için isteğe bağlı kancalar. */
export function setMediaHandlers(h: {
  play?: () => void;
  pause?: () => void;
  next?: () => void;
  prev?: () => void;
}) {
  const s = session();
  if (!s?.setActionHandler) return;
  const map: Array<[string, (() => void) | undefined]> = [
    ["play", h.play],
    ["pause", h.pause],
    ["nexttrack", h.next],
    ["previoustrack", h.prev],
  ];
  map.forEach(([action, fn]) => {
    try {
      s.setActionHandler!(action, fn ?? null);
    } catch {
      /* ignore */
    }
  });
}
