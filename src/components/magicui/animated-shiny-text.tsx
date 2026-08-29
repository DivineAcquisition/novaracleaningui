import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type FC,
} from "react";

import { cn } from "@/lib/utils";

export interface AnimatedShinyTextProps extends ComponentPropsWithoutRef<"span"> {
  shimmerWidth?: number;
}

export const AnimatedShinyText: FC<AnimatedShinyTextProps> = ({
  children,
  className,
  shimmerWidth = 100,
  ...props
}) => {
  return (
    <span
      style={
        {
          "--shiny-width": `${shimmerWidth}px`,
        } as CSSProperties
      }
      className={cn(
        "mx-auto inline-flex max-w-md font-medium",
        "animate-shiny-text bg-clip-text text-transparent bg-no-repeat [background-size:250%_100%]",
        "bg-[linear-gradient(110deg,hsl(var(--primary))_40%,#ffffff_50%,hsl(var(--primary))_60%)]",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
};
