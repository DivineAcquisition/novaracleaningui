/**
 * Brand Configuration
 * 
 * Centralized brand colors and settings for consistent styling across the app.
 * Use these values in Tailwind classes and inline styles.
 */

export const BRAND = {
  // Primary gradient colors
  colors: {
    primary: "#5500FF",
    primaryLight: "#8F7BFD",
    
    // For Tailwind arbitrary values
    gradient: {
      from: "#5500FF",
      to: "#8F7BFD",
    },
  },
  
  // Common Tailwind class combinations
  classes: {
    // Gradient backgrounds
    gradientBg: "bg-gradient-to-r from-[#5500FF] to-[#8F7BFD]",
    gradientBgBr: "bg-gradient-to-br from-[#5500FF] to-[#8F7BFD]",
    
    // Gradient text
    gradientText: "bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent",
    
    // Subtle backgrounds
    subtleBg: "bg-[#5500FF]/5",
    subtleBgGradient: "bg-gradient-to-br from-[#5500FF]/5 to-[#8F7BFD]/5",
    
    // Borders
    border: "border-[#5500FF]/20",
    borderHover: "hover:border-[#5500FF]/50",
    
    // Shadows
    shadow: "shadow-[#5500FF]/25",
    shadowLg: "shadow-lg shadow-[#5500FF]/20",
    shadowXl: "shadow-xl shadow-[#5500FF]/25",
    
    // Text colors
    text: "text-[#5500FF]",
    textLight: "text-[#8F7BFD]",
    
    // Badge styling
    badge: "bg-[#5500FF]/10 text-[#5500FF] border-[#5500FF]/20",
    
    // Button styling
    button: "bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90",
    buttonShadow: "shadow-lg shadow-[#5500FF]/25",
  },
} as const;

// Type for brand color keys
export type BrandColor = keyof typeof BRAND.colors;

// Helper to get CSS custom property value
export function getBrandColor(color: BrandColor): string {
  return BRAND.colors[color];
}

// Helper to create gradient string for inline styles
export function getBrandGradient(direction: string = "to right"): string {
  return `linear-gradient(${direction}, ${BRAND.colors.primary}, ${BRAND.colors.primaryLight})`;
}
