"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Two layouts:
 *  - "segmented" (default): a compact pill group, for two or three short
 *    options (sign in / sign up, upcoming / past).
 *  - "chips": separate chips that wrap onto a second line instead of
 *    squeezing. Use it whenever there are four or more tabs, or the labels
 *    are long, or the row sits in a narrow panel — a fixed grid there made
 *    labels like "Accountability" overlap their neighbours.
 */
type TabsVariant = "segmented" | "chips";
const TabsVariantContext = React.createContext<TabsVariant>("segmented");

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = "segmented", ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      data-variant={variant}
      className={cn(
        variant === "chips"
          ? "flex w-full flex-wrap items-center gap-1.5 text-muted-foreground"
          : "inline-flex h-10 items-center justify-center rounded-xl border border-[color:var(--hairline)] bg-muted/50 p-1 text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]",
        className,
      )}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      data-variant={variant}
      className={cn(
        variant === "chips"
          ? chipClass
          : "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_1px_2px_rgba(26,16,64,0.06)] data-[state=active]:ring-1 data-[state=active]:ring-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

/** Shared chip look, also used by SectionTabs for button-driven tab bars. */
export const chipClass =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-violet-300 data-[state=active]:bg-violet-50 data-[state=active]:text-violet-900";

export { Tabs, TabsList, TabsTrigger, TabsContent };
