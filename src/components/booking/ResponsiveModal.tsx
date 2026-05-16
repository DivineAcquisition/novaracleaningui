"use client";

// ResponsiveModal — single API that renders as:
//   • a bottom-anchored drawer on mobile (<768 px) with vaul's native
//     swipe-down-to-close + a visible drag handle + a giant tap target
//     X button. Solves the "hard to close out of" problem on phones.
//   • a centered dialog on desktop with a roomy close button.
//
// Drop-in replacement for the Dialog wrapping inside any booking
// component. Children render unchanged; the title / description are
// rendered consistently.

import * as React from "react";
import { RiCloseLine } from "@remixicon/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export interface ResponsiveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Children render inside a scroll container. */
  children: React.ReactNode;
  /** Optional sticky footer (e.g. cancel / confirm buttons). */
  footer?: React.ReactNode;
  /** Width cap for the desktop dialog. Defaults to max-w-2xl. */
  desktopMaxWidthClass?: string;
  /** Height cap for the mobile drawer body. Defaults to 92vh. */
  mobileMaxHeightClass?: string;
  /** Extra classes for the inner scroll container. */
  bodyClassName?: string;
}

export function ResponsiveModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  desktopMaxWidthClass = "max-w-2xl",
  mobileMaxHeightClass = "max-h-[92vh]",
  bodyClassName,
}: ResponsiveModalProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className={cn("flex flex-col", mobileMaxHeightClass)}>
          {/* Sticky header — title + GIANT close button. The drag handle
              that vaul prepends to DrawerContent is also visible above
              this. Together they make closing on mobile obvious. */}
          <DrawerHeader className="relative pb-3 pr-14 text-left">
            {title ? <DrawerTitle className="text-lg font-semibold">{title}</DrawerTitle> : null}
            {description ? (
              <DrawerDescription className="text-sm">{description}</DrawerDescription>
            ) : null}
            <DrawerClose asChild>
              <button
                type="button"
                aria-label="Close"
                className="absolute right-3 top-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 active:scale-95"
              >
                <RiCloseLine className="h-5 w-5" />
              </button>
            </DrawerClose>
          </DrawerHeader>

          <div className={cn("flex-1 overflow-y-auto px-4 pb-4", bodyClassName)}>
            {children}
          </div>

          {footer ? (
            <div className="sticky bottom-0 border-t bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              {footer}
            </div>
          ) : null}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          desktopMaxWidthClass,
          "max-h-[90vh] overflow-hidden p-0 flex flex-col",
        )}
      >
        {title || description ? (
          <DialogHeader className="px-6 pt-6 pr-12 text-left">
            {title ? <DialogTitle className="text-xl">{title}</DialogTitle> : null}
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
        ) : null}

        <div className={cn("flex-1 overflow-y-auto px-6 py-4", bodyClassName)}>
          {children}
        </div>

        {footer ? <div className="border-t bg-muted/30 px-6 py-3">{footer}</div> : null}
      </DialogContent>
    </Dialog>
  );
}
