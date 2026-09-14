import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { getRoute } from "@/lib/routing";
import {
  addStop,
  deleteStop,
  getStops,
  moveStop,
  toggleStopActive,
  toggleStopKind,
  updateStop,
  type Stop,
  type StopKind,
} from "@/lib/stops";

const MapView = lazy(() => import("@/components/MapView"));

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Durak Yönetimi – Acrob Elektroland" },
      {
        name: "description",
        content: "Servis güzergâhındaki durakları ekleyin, silin ve sıralayın.",
      },
      { property: "og:title", content: "Durak Yönetimi – Acrob Elektroland" },
      {
        property: "og:description",
        content:
          "Acrob Elektroland servis güzergâhını duraklar ve yol noktalarıyla harita üzerinde yönetin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ClientOnly
      fallback={
        <div className="min-h-screen flex items-center justify-center text-muted-foreground">
          Yükleniyor...
        </div>
      }
    >
      <AdminApp />
    </ClientOnly>
  ),
});

function AdminApp() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingPoint, setPendingPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [kind, setKind] = useState<StopKind>("stop");
  const [routePath, setRoutePath] = useState<[number, number][] | null>(null);
  // Düzenleme: seçili durağın adı ve konumu
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editLat, setEditLat] = useState("");
  const [editLng, setEditLng] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const startEdit = (s: Stop) => {
    setEditId(s.id);
    setEditName(s.name);
    setEditLat(s.lat.toFixed(6));
    setEditLng(s.lng.toFixed(6));
    setEditError(null);
    setPendingPoint({ lat: s.lat, lng: s.lng });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditError(null);
    setPendingPoint(null);
  };

  const saveEdit = () => {
    if (!editId) return;
    const latN = parseFloat(editLat);
    const lngN = parseFloat(editLng);
    const finalName = editName.trim();
    if (!finalName) return setEditError("Durak adı boş olamaz.");
    if (!Number.isFinite(latN) || !Number.isFinite(lngN))
      return setEditError("Enlem ve boylam sayı olmalı.");
    if (latN < -90 || latN > 90 || lngN < -180 || lngN > 180)
      return setEditError("Koordinat aralığı geçersiz.");
    setStops(updateStop(editId, { name: finalName, lat: latN, lng: lngN }));
    cancelEdit();
  };

  useEffect(() => setStops(getStops()), []);

  useEffect(() => {
    let cancelled = false;
    setRoutePath(null);
    const routeStops = stops.filter((s) => s.active);
    if (routeStops.length < 2) return;
    getRoute(routeStops).then((route) => {
      if (!cancelled) setRoutePath(route?.path ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [stops]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const latN = parseFloat(lat);
    const lngN = parseFloat(lng);
    const finalName = name.trim() || (kind === "waypoint" ? "ROTA" : "");
    if (!finalName) return setError("Durak adı boş olamaz.");
    if (!Number.isFinite(latN) || !Number.isFinite(lngN))
      return setError("Enlem ve boylam sayı olmalı.");
    if (latN < -90 || latN > 90 || lngN < -180 || lngN > 180)
      return setError("Koordinat aralığı geçersiz.");
    setStops(addStop({ name: finalName, lat: latN, lng: lngN, kind }));
    setName("");
    setLat("");
    setLng("");
    setPendingPoint(null);
  };

  const handleMapClick = (clickLat: number, clickLng: number) => {
    // Bir durak düzenleniyorsa harita tıklaması o durağın yeni konumunu belirler.
    if (editId) {
      setEditLat(clickLat.toFixed(6));
      setEditLng(clickLng.toFixed(6));
      setPendingPoint({ lat: clickLat, lng: clickLng });
      setEditError(null);
      return;
    }
    setLat(clickLat.toFixed(6));
    setLng(clickLng.toFixed(6));
    setPendingPoint({ lat: clickLat, lng: clickLng });
    setError(null);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/" className="hud-label hover:text-primary">
            ← Ana Sayfa
          </Link>
          <div className="flex-1 text-center">
            <h1 className="text-lg font-bold">DURAK YÖNETİMİ</h1>
          </div>
          <div className="w-20" />
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 flex flex-col lg:flex-row gap-4">
        <div className="lg:w-[420px] flex flex-col gap-4">
          <form onSubmit={handleAdd} className="panel p-5 space-y-3">
            <div className="hud-label">Yeni Durak Ekle</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("stop")}
                className={`py-2 rounded-md text-sm font-semibold border transition ${kind === "stop" ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border text-muted-foreground hover:text-foreground"}`}
              >
                🚏 Durak (seçilebilir)
              </button>
              <button
                type="button"
                onClick={() => setKind("waypoint")}
                className={`py-2 rounded-md text-sm font-semibold border transition ${kind === "waypoint" ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border text-muted-foreground hover:text-foreground"}`}
              >
                • Rota noktası
              </button>
            </div>
            <input
              type="text"
              placeholder={kind === "waypoint" ? "İsim (boş = ROTA)" : "Durak adı (örn. Kızılay)"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                inputMode="decimal"
                placeholder="Enlem (39.925)"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="bg-input border border-border rounded-md px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <input
                type="text"
                inputMode="decimal"
                placeholder="Boylam (32.85)"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="bg-input border border-border rounded-md px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {error && <div className="text-sm text-red-400">{error}</div>}
            <button className="w-full bg-primary text-primary-foreground font-semibold py-2.5 rounded-md hover:bg-primary/90 transition">
              Durağı Ekle
            </button>
          </form>

          <div className="panel p-4">
            <div className="hud-label mb-3">
              Güzergâh ({stops.filter((s) => s.kind === "stop" && s.active).length} durak ·{" "}
              {stops.filter((s) => s.kind === "waypoint" && s.active).length} rota noktası ·{" "}
              {stops.filter((s) => !s.active).length} pasif)
            </div>
            <ul className="space-y-2">
              {stops.map((s) =>
                editId === s.id ? (
                  <li key={s.id} className="rounded-md p-3 bg-secondary/60 space-y-2">
                    <div className="hud-label">{s.order}. NOKTAYI DÜZENLE</div>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Durak adı"
                      className="w-full bg-input border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editLat}
                        onChange={(e) => setEditLat(e.target.value)}
                        placeholder="Enlem"
                        className="bg-input border border-border rounded-md px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        value={editLng}
                        onChange={(e) => setEditLng(e.target.value)}
                        placeholder="Boylam"
                        className="bg-input border border-border rounded-md px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Yeni konum için haritaya dokunabilirsin.
                    </div>
                    {editError && <div className="text-sm text-red-400">{editError}</div>}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={saveEdit}
                        className="bg-primary text-primary-foreground font-semibold py-2 rounded-md hover:bg-primary/90 transition"
                      >
                        Kaydet
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="border border-border text-muted-foreground font-semibold py-2 rounded-md hover:text-foreground transition"
                      >
                        Vazgeç
                      </button>
                    </div>
                  </li>
                ) : (
                  <li
                    key={s.id}
                    className={`flex items-center gap-2 rounded-md p-2 ${!s.active ? "bg-secondary/10 opacity-45" : s.kind === "waypoint" ? "bg-secondary/20 opacity-70" : "bg-secondary/50"}`}
                  >
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={() => setStops(toggleStopActive(s.id))}
                      aria-label={`${s.name} güzergâhta kullanılsın`}
                      title={s.active ? "Güzergâhtan çıkar" : "Güzergâha dahil et"}
                      className="h-4 w-4 shrink-0 accent-primary cursor-pointer"
                    />
                    <div
                      className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${s.kind === "waypoint" ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}
                    >
                      {s.order}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">
                        {s.kind === "waypoint" && (
                          <span className="text-muted-foreground mr-1">•</span>
                        )}
                        {s.name}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                      </div>
                    </div>
                    <button
                      onClick={() => startEdit(s)}
                      className="text-muted-foreground hover:text-primary px-1"
                      title="Adı ve konumu değiştir"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => setStops(toggleStopKind(s.id))}
                      className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary"
                      title={s.kind === "stop" ? "Rota noktasına çevir" : "Durağa çevir"}
                    >
                      {s.kind === "stop" ? "→ROTA" : "→DURAK"}
                    </button>
                    <button
                      onClick={() => setStops(moveStop(s.id, "up"))}
                      className="text-muted-foreground hover:text-primary px-1"
                      title="Yukarı"
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => setStops(moveStop(s.id, "down"))}
                      className="text-muted-foreground hover:text-primary px-1"
                      title="Aşağı"
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`"${s.name}" durağını silmek istiyor musun?`)) {
                          setStops(deleteStop(s.id));
                        }
                      }}
                      className="text-red-400 hover:text-red-300 px-2"
                      title="Sil"
                    >
                      ✕
                    </button>
                  </li>
                ),
              )}
              {stops.length === 0 && (
                <li className="text-sm text-muted-foreground text-center py-4">Henüz durak yok.</li>
              )}
            </ul>
          </div>
        </div>

        <div className="flex-1 panel overflow-hidden min-h-[400px] lg:min-h-[600px]">
          <Suspense fallback={null}>
            <MapView
              stops={stops.filter((s) => s.active)}
              busPosition={pendingPoint}
              routePath={routePath}
              onMapClick={handleMapClick}
              className="h-full min-h-[400px] lg:min-h-[600px]"
            />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
