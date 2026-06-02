import type { Config } from "tailwindcss";
import rootConfig from "../tailwind.config";

// Reuse the web app's full Tailwind theme/plugins, but scan the shared
// source tree (../src) plus this SPA's own files for class names.
export default {
  ...(rootConfig as Config),
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../src/**/*.{ts,tsx}",
  ],
} satisfies Config;
