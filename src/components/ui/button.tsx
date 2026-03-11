"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:translate-y-[1px]",
  {
    variants: {
      variant: {
        default: "bg-gradient-primary text-white border border-white/15 shadow-[0_3px_0_0_hsl(260,100%,35%),0_4px_10px_-2px_hsl(260,100%,50%/0.25),inset_0_1px_0_0_hsl(0,0%,100%/0.15)] hover:shadow-[0_1px_0_0_hsl(260,100%,35%),0_3px_8px_-2px_hsl(260,100%,50%/0.25),inset_0_1px_0_0_hsl(0,0%,100%/0.15)] hover:translate-y-[2px] active:shadow-[0_0px_0_0_hsl(260,100%,35%),inset_0_1px_2px_0_hsl(260,100%,30%/0.3)] active:translate-y-[3px]",
        destructive: "bg-destructive text-destructive-foreground border border-white/15 shadow-[0_3px_0_0_hsl(0,70%,45%),0_4px_10px_-2px_hsl(0,84%,60%/0.25),inset_0_1px_0_0_hsl(0,0%,100%/0.15)] hover:shadow-[0_1px_0_0_hsl(0,70%,45%),0_3px_8px_-2px_hsl(0,84%,60%/0.25)] hover:translate-y-[2px] active:shadow-[0_0px_0_0_hsl(0,70%,45%)] active:translate-y-[3px]",
        outline: "border border-border bg-background shadow-[0_1px_2px_0_hsl(260,25%,85%/0.5)] hover:bg-accent/30 hover:border-primary/30 hover:shadow-sm active:shadow-none active:translate-y-[1px]",
        secondary: "bg-secondary text-secondary-foreground border border-white/20 shadow-[0_2px_0_0_hsl(260,35%,88%),inset_0_1px_0_0_hsl(0,0%,100%/0.4)] hover:shadow-[0_1px_0_0_hsl(260,35%,88%)] hover:translate-y-[1px] active:shadow-none active:translate-y-[2px]",
        ghost: "hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary-hover",
        success: "bg-success text-white border border-white/15 shadow-[0_3px_0_0_hsl(142,76%,22%),0_4px_10px_-2px_hsl(142,76%,32%/0.25),inset_0_1px_0_0_hsl(0,0%,100%/0.15)] hover:shadow-[0_1px_0_0_hsl(142,76%,22%),0_3px_8px_-2px_hsl(142,76%,32%/0.25)] hover:translate-y-[2px] active:shadow-[0_0px_0_0_hsl(142,76%,22%)] active:translate-y-[3px]",
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
