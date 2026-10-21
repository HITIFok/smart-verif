// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Build statique pour GitHub Pages : GH_PAGES=1 npm run build
// → mode SPA (coquille HTML client, aucun serveur requis) + base /smart-verif/
//   (URL projet hitifok.github.io/smart-verif).
// Sans GH_PAGES, le build reste identique au build Lovable/Cloudflare.
const ghPages = process.env["GH_PAGES"] === "1";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    ...(ghPages ? { spa: { enabled: true } } : {}),
  },
  ...(ghPages ? { vite: { base: "/smart-verif/" } } : {}),
});
