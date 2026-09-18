import type { ApproachStage } from "@/lib/approach-alert";

type PassengerStopStage = Extract<ApproachStage, "near" | "arriving" | "door">;

const STAGE_FILE: Record<PassengerStopStage, string> = {
  near: "5dk",
  arriving: "2dk",
  door: "ulasti",
};

let playbackQueue: Promise<void> = Promise.resolve();

function stopNumber(stopName: string): number | null {
  const match = stopName.trim().match(/^([1-9])\s*\.?\s*DURAK$/i);
  return match ? Number(match[1]) : null;
}

function audioUrl(stopName: string, stage: PassengerStopStage): string | null {
  const number = stopNumber(stopName);
  if (number == null) return null;
  return `${import.meta.env.BASE_URL}audio/yolcu-durak-${number}-${STAGE_FILE[stage]}.mp3`;
}

/** Seçilen 1–9. durağın üç anonsunu tarayıcı ve service worker önbelleğine hazırlar. */
export function preloadPassengerStopAnnouncements(stopName: string) {
  if (typeof window === "undefined") return;
  (["near", "arriving", "door"] as const).forEach((stage) => {
    const url = audioUrl(stopName, stage);
    if (!url) return;
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = url;
    audio.load();
  });
}

/**
 * MP3'leri tek sıra hâlinde oynatır. false sonucu, seçimin numaralı durak
 * olmadığını veya dosyanın oynatılamadığını belirtir; tarayıcı TTS kullanılmaz.
 */
export function playPassengerStopAnnouncement(
  stopName: string,
  stage: ApproachStage,
  onPlayback?: (playing: boolean) => void,
): Promise<boolean> {
  if (stage === "far") return Promise.resolve(false);
  const url = audioUrl(stopName, stage);
  if (!url || typeof window === "undefined") return Promise.resolve(false);

  let played = false;
  playbackQueue = playbackQueue
    .catch(() => undefined)
    .then(
      () =>
        new Promise<void>((resolve) => {
          const audio = new Audio(url);
          audio.preload = "auto";
          const finish = () => {
            audio.onended = null;
            audio.onerror = null;
            onPlayback?.(false);
            resolve();
          };
          audio.onended = finish;
          audio.onerror = finish;
          onPlayback?.(true);
          void audio
            .play()
            .then(() => {
              played = true;
            })
            .catch(finish);
        }),
    );

  return playbackQueue.then(() => played);
}
