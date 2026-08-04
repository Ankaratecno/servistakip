import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import path from "node:path";

// Statik (SSR'siz) SPA build — GitHub Pages icin.
// Kullanim: PAGES_BASE=/ServisTakip/ bun run build:pages
export default defineConfig({
  base: process.env["PAGES_BASE"] || "/",
  root: path.resolve(process.cwd(), "pages"),
  publicDir: path.resolve(process.cwd(), "public"),
  plugins: [react(), tailwindcss(), tsConfigPaths({ projects: ["./tsconfig.json"] })],
  resolve: {
    alias: [
      // SPA build: __root.tsx uses TanStack Start's shellComponent/<Scripts/>,
      // which has no meaning (and hangs) in a plain client-side render.
      {
        find: /.*\/routes\/__root(\.tsx)?$/,
        replacement: path.resolve(process.cwd(), "pages/root-spa.tsx"),
      },
      { find: "@", replacement: path.resolve(process.cwd(), "src") },
    ],
  },
  build: {
    outDir: path.resolve(process.cwd(), "dist-pages"),
    emptyOutDir: true,
  },
});
