// Bulgu 1 & 2: Ekran kilidi (Screen Wake Lock) + sekme arka plandan dönüşünde
// kilidi yeniden alma. Ekran kapanınca GPS takibi ve PeerJS yayını duruyordu.

type Sentinel = { released: boolean; release: () => Promise<void> } & EventTarget;

let sentinel: Sentinel | null = null;
let wanted = false;
let listenerBound = false;

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

async function acquire(): Promise<boolean> {
  if (!isWakeLockSupported() || !wanted) return false;
  if (sentinel && !sentinel.released) return true;
  try {
    const wl = (
      navigator as unknown as {
        wakeLock: { request: (t: "screen") => Promise<Sentinel> };
      }
    ).wakeLock;
    sentinel = await wl.request("screen");
    sentinel.addEventListener?.("release", () => {
      sentinel = null;
    });
    return true;
  } catch {
    sentinel = null;
    return false;
  }
}

function bindVisibility() {
  if (listenerBound || typeof document === "undefined") return;
  listenerBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wanted) void acquire();
  });
}

/** Ekranın kapanmasını engeller. Dönen fonksiyon kilidi bırakır. */
export async function keepScreenAwake(): Promise<boolean> {
  wanted = true;
  bindVisibility();
  return acquire();
}

export async function releaseScreenAwake(): Promise<void> {
  wanted = false;
  try {
    await sentinel?.release();
  } catch {
    /* ignore */
  }
  sentinel = null;
}

export function isScreenAwake(): boolean {
  return Boolean(sentinel && !sentinel.released);
}
