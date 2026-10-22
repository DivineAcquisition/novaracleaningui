"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RiSearchLine } from "@remixicon/react";
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

type PageLink = { title: string; url: string; description: string };

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

export function AdminCommandMenu({ pages }: { pages: PageLink[] }) {
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

  const needle = query.trim().toLowerCase();
  const pageHits = pages.filter((page) =>
    `${page.title} ${page.description}`.toLowerCase().includes(needle),
  );

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
              {pageHits.slice(0, 8).map((page) => (
                <CommandItem key={page.url} value={page.title} onSelect={() => go(page.url)}>
                  <span className="font-medium">{page.title}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">{page.description}</span>
                </CommandItem>
              ))}
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
                      onSelect={() => go("/admin/cleaners")}
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
