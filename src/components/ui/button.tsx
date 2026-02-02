import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground border-2 border-white/30 shadow-[0_4px_0_0_rgba(0,0,0,0.2),inset_0_1px_0_0_rgba(255,255,255,0.3)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.2),inset_0_1px_0_0_rgba(255,255,255,0.3)] hover:translate-y-[2px] active:shadow-[0_0px_0_0_rgba(0,0,0,0.2)] active:translate-y-[4px]",
        destructive: "bg-destructive text-destructive-foreground border-2 border-white/20 shadow-[0_4px_0_0_rgba(0,0,0,0.2),inset_0_1px_0_0_rgba(255,255,255,0.2)] hover:shadow-[0_2px_0_0_rgba(0,0,0,0.2)] hover:translate-y-[2px] active:shadow-none active:translate-y-[4px]",
        outline: "border-2 border-border bg-background shadow-[0_3px_0_0_rgba(0,0,0,0.08),inset_0_1px_0_0_rgba(255,255,255,0.8)] hover:bg-accent/50 hover:border-primary/40 hover:shadow-[0_1px_0_0_rgba(0,0,0,0.08)] hover:translate-y-[2px] active:shadow-none active:translate-y-[3px]",
        secondary: "bg-secondary text-secondary-foreground border-2 border-white/40 shadow-[0_3px_0_0_rgba(0,0,0,0.1),inset_0_1px_0_0_rgba(255,255,255,0.5)] hover:shadow-[0_1px_0_0_rgba(0,0,0,0.1)] hover:translate-y-[2px] active:shadow-none active:translate-y-[3px]",
        ghost: "hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline hover:text-primary-hover",
      },
      size: {
        default: "h-10 px-5 py-2.5",
        sm: "h-8 rounded-md px-3 py-1.5 text-xs",
        lg: "h-11 rounded-lg px-6 py-3",
        icon: "h-10 w-10",
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
