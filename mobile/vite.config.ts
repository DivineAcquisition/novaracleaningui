import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import tailwind from "tailwindcss";
import autoprefixer from "autoprefixer";
import tailwindConfig from "./tailwind.config";

// ─── Novara Pro contractor app — Vite SPA build ─────────────────────────────
//
// Reuses the existing React screens in ../src/views/cleaner by aliasing the
// handful of Next.js-only imports (next/navigation, next/link, next/image)
// to thin react-router shims. Output (mobile/dist) is bundled into the
// native app by Capacitor (see capacitor.config.ts -> webDir).

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sxdraeptzuamsgjcvfeg.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I";

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../src"),
      "next/navigation": path.resolve(__dirname, "src/shims/next-navigation.ts"),
      "next/link": path.resolve(__dirname, "src/shims/next-link.tsx"),
      "next/image": path.resolve(__dirname, "src/shims/next-image.tsx"),
    },
    dedupe: ["react", "react-dom"],
  },
  css: {
    postcss: {
      plugins: [tailwind(tailwindConfig as never), autoprefixer()],
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(SUPABASE_URL),
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(SUPABASE_ANON_KEY),
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "es2019",
  },
});
