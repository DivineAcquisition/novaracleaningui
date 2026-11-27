"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RiSearchLine } from "@/components/icons";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

import { searchText, type AdminNavItem } from "@/components/admin/admin-nav";

/** A navigation entry plus the sidebar group it lives in. */
export type CommandPage = { item: AdminNavItem; group: string };

type BookingHit = {
  id: string;
  booking_number: number | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  service_date: string | null;
};

type CleanerHit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

function safeQuery(value: string) {
  return value.replace(/[^a-zA-Z0-9@.\- ]/g, "").trim();
}

export function AdminCommandMenu({ pages }: { pages: CommandPage[]; role?: "admin" | "va" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [bookings, setBookings] = useState<BookingHit[]>([]);
  const [cleaners, setCleaners] = useState<CleanerHit[]>([]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = safeQuery(query);
    if (q.length < 2) {
      setBookings([]);
      setCleaners([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      const pattern = `%${q}%`;
      const bookingFilter = [`first_name.ilike.${pattern}`, `last_name.ilike.${pattern}`, `email.ilike.${pattern}`];
      if (/^\d+$/.test(q)) bookingFilter.unshift(`booking_number.eq.${Number(q)}`);
      const [bookingRes, cleanerRes] = await Promise.all([
        supabase
          .from("bookings")
          .select("id, booking_number, first_name, last_name, email, service_date")
          .or(bookingFilter.join(","))
          .order("created_at", { ascending: false })
          .limit(6),
        supabase
          .from("cleaners")
          .select("id, first_name, last_name, email")
          .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`)
          .neq("status", "terminated")
          .limit(6),
      ]);
      if (cancelled) return;
      setBookings((bookingRes.data as BookingHit[]) || []);
      setCleaners((cleanerRes.data as CleanerHit[]) || []);
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  // Pages match on label, help text, group and former labels (CSR, Internal
  // Booking, Operations, Accounts, Intake …). Every word must appear.
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const pageHits = pages.filter(({ item, group }) => {
    const hay = searchText(item, group);
    return words.every((w) => hay.includes(w));
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="hidden h-8 gap-2 px-2.5 text-xs sm:inline-flex"
        onClick={() => setOpen(true)}
      >
        <RiSearchLine className="h-3.5 w-3.5" />
        Search
        <kbd className="rounded border border-[color:var(--hairline)] bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="sm:hidden"
        aria-label="Search admin"
        onClick={() => setOpen(true)}
      >
        <RiSearchLine className="h-4 w-4" />
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Jump to a page, booking, or cleaner"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {pageHits.length > 0 ? (
            <CommandGroup heading="Pages">
              {pageHits.slice(0, 10).map(({ item, group }) => {
                const matchedAlias = words.length
                  ? item.aliases?.find((a) => words.every((w) => a.toLowerCase().includes(w)) && !item.title.toLowerCase().includes(words.join(" ")))
                  : undefined;
                return (
                  <CommandItem key={item.id} value={searchText(item, group)} onSelect={() => go(item.url)}>
                    <item.icon className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{item.title}</span>
                      {matchedAlias ? (
                        <span className="ml-1.5 text-xs text-muted-foreground">(formerly {matchedAlias})</span>
                      ) : null}
                      <span className="block truncate text-xs text-muted-foreground">{item.help}</span>
                    </span>
                    <span className="ml-2 shrink-0 text-[11px] text-muted-foreground/80">{group}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
          {bookings.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Bookings">
                {bookings.map((booking) => {
                  const name = `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || booking.email || "Booking";
                  const number = booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : "Booking";
                  return (
                    <CommandItem
                      key={booking.id}
                      value={`${number} ${name} ${booking.email || ""}`}
                      onSelect={() => go(`/admin/bookings?highlight=${booking.id}`)}
                    >
                      <span className="font-medium">{number}</span>
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {name}
                        {booking.service_date ? ` · ${booking.service_date}` : ""}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          ) : null}
          {cleaners.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Cleaners">
                {cleaners.map((cleaner) => {
                  const name = `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || cleaner.email || "Cleaner";
                  return (
                    <CommandItem
                      key={cleaner.id}
                      value={`${name} ${cleaner.email || ""}`}
                      onSelect={() => go(`/admin/cleaners?cleaner=${encodeURIComponent(cleaner.id)}`)}
                    >
                      <span className="font-medium">{name}</span>
                      {cleaner.email ? (
                        <span className="ml-2 truncate text-xs text-muted-foreground">{cleaner.email}</span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
