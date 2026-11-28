import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";
import { heroui } from "@heroui/react";

/**
 * A colour ramp whose shades can be re-pointed by CSS variables. Each shade
 * compiles to rgb(var(--tw-<name>-<shade>, <default>) / <alpha-value>): with
 * no variable set (public site, booking flow) it is exactly the default
 * colour; inside the admin workspace globals.css sets the variables to the
 * Selestial palette, so the same class names (text-slate-500, bg-violet-600,
 * bg-brand-50 …) take on the workspace look without touching every screen.
 */
const hexToRgb = (hex: string) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const themable = (name: string, palette: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(palette).map(([shade, hex]) => [shade, `rgb(var(--tw-${name}-${shade}, ${hexToRgb(hex)}) / <alpha-value>)`]),
  );
const BRAND_RAMP = {
  50: "#F6F2FF",
  100: "#EDE5FF",
  200: "#D4C4FE",
  300: "#B49AFE",
  400: "#8E5BFF",
  500: "#6810FE",
  600: "#5A0BE6",
  700: "#4A0CD0",
  800: "#3809A0",
  900: "#26066E",
  950: "#16043F",
};

export default {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
    // HeroUI component styles live in its theme package and must be scanned
    // so the generated utility classes aren't tree-shaken away.
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // One face site-wide: Inter Display (src/lib/fonts.ts) is registered
        // as --font-inter, Geist Mono as --font-mono.
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        jakarta: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        heading: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Tailwind 3 compiles weights to static numbers, unlike Selestial's
      // Tailwind 4 --font-weight-* theme variables. Routing them through
      // --fw-* gives the same effect: 400/500/600/700 on the public site,
      // 450/550/650/750 inside the admin scope (globals.css).
      fontWeight: {
        normal: 'var(--fw-normal, 400)',
        medium: 'var(--fw-medium, 500)',
        semibold: 'var(--fw-semibold, 600)',
        bold: 'var(--fw-bold, 700)',
      },
      colors: {
        ink: { DEFAULT: "#0B0A11", muted: "#5F5B6B" },
        line: "#E9E7EE",
        brand: themable("brand", BRAND_RAMP),
        slate: themable("slate", colors.slate),
        zinc: themable("zinc", colors.zinc),
        violet: themable("violet", colors.violet),
        indigo: themable("indigo", colors.indigo),
        purple: themable("purple", colors.purple),
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        "focus-ring": "hsl(var(--focus-ring))",
        "focus-ring-offset": "hsl(var(--focus-ring-offset))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
          glow: "hsl(var(--primary-glow))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      backgroundImage: {
        'gradient-primary': 'var(--gradient-primary)',
        'gradient-hero': 'var(--gradient-hero)',
        'gradient-lavender': 'var(--gradient-lavender)',
      },
      boxShadow: {
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
        'xl': 'var(--shadow-xl)',
        'card': 'var(--shadow-card)',
        'lavender': 'var(--shadow-lavender)',
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(100%)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(calc(-100% - var(--gap)))" },
        },
        "marquee-vertical": {
          from: { transform: "translateY(0)" },
          to: { transform: "translateY(calc(-100% - var(--gap)))" },
        },
        shine: {
          "0%": { backgroundPosition: "0% 0%" },
          "50%": { backgroundPosition: "100% 100%" },
          to: { backgroundPosition: "0% 0%" },
        },
        "shiny-text": {
          "0%, 90%, 100%": {
            backgroundPosition: "calc(-100% - var(--shiny-width)) 0",
          },
          "30%, 60%": {
            backgroundPosition: "calc(100% + var(--shiny-width)) 0",
          },
        },
        "shimmer-slide": {
          to: { transform: "translate(calc(100cqw - 100%), 0)" },
        },
        "spin-around": {
          "0%": { transform: "translateZ(0) rotate(0)" },
          "15%, 35%": { transform: "translateZ(0) rotate(90deg)" },
          "65%, 85%": { transform: "translateZ(0) rotate(270deg)" },
          "100%": { transform: "translateZ(0) rotate(360deg)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "slide-up": "slide-up 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        marquee: "marquee var(--duration) infinite linear",
        "marquee-vertical": "marquee-vertical var(--duration) linear infinite",
        shine: "shine var(--duration) infinite linear",
        "shiny-text": "shiny-text 8s infinite",
        "shimmer-slide": "shimmer-slide var(--speed) ease-in-out infinite alternate",
        "spin-around": "spin-around calc(var(--speed) * 2) infinite linear",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // HeroUI (v2) themed to the Novara purple brand so HeroUI components
    // match the existing shadcn/Tailwind look. shadcn primitives keep
    // working unchanged — HeroUI is additive and lives behind <HeroUIProvider>.
    heroui({
      themes: {
        light: {
          colors: {
            primary: {
              DEFAULT: "#6810FE",
              foreground: "#FFFFFF",
            },
            focus: "#6810FE",
          },
        },
        dark: {
          colors: {
            primary: {
              DEFAULT: "#9F7BFF",
              foreground: "#FFFFFF",
            },
            focus: "#9F7BFF",
          },
        },
      },
    }),
  ],
} satisfies Config;
