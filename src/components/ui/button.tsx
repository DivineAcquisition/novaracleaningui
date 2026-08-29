"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold tracking-tight transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "btn-coss btn-trail border border-white/20 bg-gradient-primary text-white shadow-[0_4px_14px_-3px_rgba(92,15,254,0.45)] hover:shadow-[0_8px_22px_-4px_rgba(92,15,254,0.55)] active:shadow-[0_2px_8px_-3px_rgba(92,15,254,0.4)]",
        destructive:
          "btn-coss btn-trail border border-white/20 bg-destructive text-destructive-foreground shadow-[0_4px_14px_-3px_hsl(0_84%_60%/0.45)] hover:shadow-[0_8px_22px_-4px_hsl(0_84%_60%/0.55)]",
        outline:
          "btn-coss border border-border bg-background shadow-sm hover:bg-brand-50 hover:border-primary/40 hover:text-primary active:bg-brand-100",
        secondary:
          "btn-coss border border-transparent bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/70 active:bg-secondary/80",
        ghost: "hover:bg-brand-50 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary-hover",
        success:
          "btn-coss btn-trail border border-white/20 bg-success text-white shadow-[0_4px_14px_-3px_hsl(142_76%_32%/0.45)] hover:shadow-[0_8px_22px_-4px_hsl(142_76%_32%/0.55)]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 rounded-lg px-3 py-1.5 text-xs",
        lg: "h-11 rounded-xl px-6 py-2.5",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
