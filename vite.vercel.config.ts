import tailwindcss from "@tailwindcss/postcss";
import vinext from "vinext";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [
    vinext(),
    nitro({
      compatibilityDate: "2026-07-29",
      serverDir: "./nitro/server",
      vercel: {
        functions: {
          maxDuration: 120,
          runtime: "nodejs22.x",
        },
      },
    }),
  ],
});
