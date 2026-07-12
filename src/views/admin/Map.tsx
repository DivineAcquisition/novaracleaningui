"use client";

// ─── Admin Operational Map (v2 — 2026-05-22) ───────────────────────────
//
// Three datasets, one map, one panel:
//   1. Cleaner home-base pins (green/amber/grey by status) plotted at
//      cleaners.home_lat/home_lng (falls back to ZIP centroid via
//      geocode_cache when home_lat/lng is null).
//   2. Booking pins for the next 14 days, color-coded by status, plotted
//      at booking.lat/lng or geocoded address.
//   3. Side panel cross-references:
//        * Top booking zips this month
//        * COVERAGE GAPS — zips where customers are booking but no
//          cleaner has them in service_zip_codes (the "underserved
//          markets" insight).
//        * Capacity per zip (cleaners × max_weekly_bookings ÷ bookings)
//
// All live, all from the DB / geocode-address edge fn. Brand-aligned
// emerald theme, no AdminLayout (the route does that).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiMapPin2Line,
  RiToolsLine,
  RiCalendarCheckLine,
  RiRefreshLine,
  RiAlertLine,
  RiTrophyLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { loadGooglePlaces } from "@/lib/google-places-loader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CleanerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  status: string | null;
  home_zip: string | null;
  home_lat: number | null;
  home_lng: number | null;
  service_zip_codes: string[] | null;
  max_weekly_bookings: number | null;
  pay_tier: string | null;
}

interface BookingRow {
  id: string;
  booking_number: number | null;
  service_date: string | null;
  status: string | null;
  service_type: string | null;
  zip_code: string | null;
  city: string | null;
  total_estimate_cents: number | null;
  first_name: string | null;
  last_name: string | null;
}

interface Pin {
  id: string;
  kind: "cleaner" | "booking" | "gps";
  lat: number;
  lng: number;
  color: string;
  title: string;
  subtitle: string;
}

const CLEANER_COLOR: Record<string, string> = {
  active: "#10b981",
  pending: "#f59e0b",
  inactive: "#94a3b8",
  terminated: "#f43f5e",
};
const BOOKING_COLOR: Record<string, string> = {
  confirmed: "#10b981",
  assigned: "#6366f1",
  completed: "#3b82f6",
  pending_payment: "#f59e0b",
  pending_details: "#f59e0b",
  cancelled: "#9ca3af",
};

export default function AdminMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [mapsAvailable, setMapsAvailable] = useState<boolean | null>(null);

  const [loading, setLoading] = useState(true);
  const [cleaners, setCleaners] = useState<CleanerRow[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [zipCentroids, setZipCentroids] = useState<Record<string, { lat: number; lng: number }>>({});
  const [apployePings, setApployePings] = useState<Array<{
    cleanerId: string | null;
    cleanerName: string | null;
    lat: number | null;
    lng: number | null;
    status: string;
    pingedAt: string | null;
    activeBookingNumber: number | null;
  }>>([]);
  const [apployeConfigured, setApployeConfigured] = useState<boolean | null>(null);

  // Poll Apploye live tracking every 30s — soft-fails to a "not
  // configured" banner if APPLOYE_API_KEY isn't set.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("apploye-live-tracking");
        if (!alive) return;
        if (error) {
          setApployeConfigured(false);
          return;
        }
        const d = data as { ok?: boolean; members?: any[] };
        if (d?.ok) {
          setApployeConfigured(true);
          setApployePings(
            (d.members || []).filter((m: any) => typeof m.lat === "number" && typeof m.lng === "number"),
          );
        } else {
          setApployeConfigured(false);
        }
      } catch (_) {
        if (alive) setApployeConfigured(false);
      }
    };
    void tick();
    const i = setInterval(() => void tick(), 30000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  // The actual Google "auth failure" reason (referrer block, billing,
  // API not enabled, etc.) is not exposed via the JS Maps API — Google
  // calls a globally-scoped `gm_authFailure` callback. We surface that
  // here so the user gets actionable error copy instead of a silent
  // "Google Maps unavailable".
  const [mapsAuthError, setMapsAuthError] = useState<string | null>(null);

  useEffect(() => {
    // Initialise Maps once.
    let cancelled = false;
    (window as any).gm_authFailure = () => {
      console.warn("[admin-map] Google Maps reported gm_authFailure");
      setMapsAuthError(
        "Google Maps rejected the API key for this domain. " +
          "In Google Cloud Console → APIs & Services → Credentials, edit the key and " +
          "add HTTP referrers for *.novaracleaning.com/* and localhost:3000/*, then save.",
      );
      setMapsAvailable(false);
    };
    void (async () => {
      try {
        const places = await loadGooglePlaces();
        if (cancelled || !places) {
          setMapsAvailable(false);
          return;
        }
        if (!containerRef.current || !(window as any).google?.maps) {
          setMapsAvailable(false);
          return;
        }
        mapRef.current = new (window as any).google.maps.Map(containerRef.current, {
          center: { lat: 39.299, lng: -76.609 }, // Baltimore default
          zoom: 10,
          mapTypeControl: false,
          streetViewControl: false,
          styles: [
            { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
          ],
        });
        setMapsAvailable(true);
      } catch (err) {
        console.warn("[admin-map] init failed", err);
        setMapsAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const in14 = new Date();
      in14.setDate(in14.getDate() + 14);
      const [cs, bs, zc] = await Promise.all([
        supabase
          .from("cleaners")
          .select("id,first_name,last_name,status,home_zip,home_lat,home_lng,service_zip_codes,max_weekly_bookings,pay_tier")
          .in("status", ["active", "pending"])
          .limit(500),
        supabase
          .from("bookings")
          .select("id,booking_number,service_date,status,service_type,zip_code,city,total_estimate_cents,first_name,last_name")
          .gte("service_date", today)
          .lte("service_date", in14.toISOString().slice(0, 10))
          .not("status", "in", '("cancelled")')
          .limit(500),
        supabase.from("geocode_cache" as any).select("zip,lat,lng").limit(2000),
      ]);
      setCleaners((cs.data as unknown as CleanerRow[]) || []);
      setBookings((bs.data as unknown as BookingRow[]) || []);
      const map: Record<string, { lat: number; lng: number }> = {};
      (zc.data as unknown as Array<{ zip: string; lat: number; lng: number }> | null)?.forEach((r) => {
        if (r.zip && r.lat && r.lng) map[r.zip] = { lat: r.lat, lng: r.lng };
      });
      setZipCentroids(map);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load map data");
    } finally {
      setLoading(false);
    }
  };

  // ─── Pin computation ───────────────────────────────────────────────────
  const pins = useMemo((): Pin[] => {
    const out: Pin[] = [];

    cleaners.forEach((c) => {
      const lat = c.home_lat ?? (c.home_zip && zipCentroids[c.home_zip]?.lat);
      const lng = c.home_lng ?? (c.home_zip && zipCentroids[c.home_zip]?.lng);
      if (!lat || !lng) return;
      out.push({
        id: `cleaner-${c.id}`,
        kind: "cleaner",
        lat,
        lng,
        color: CLEANER_COLOR[(c.status || "pending").toLowerCase()] || "#94a3b8",
        title: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
        subtitle: `${c.pay_tier || "Tier —"} · ZIPs: ${(c.service_zip_codes || []).slice(0, 4).join(", ") || "—"}`,
      });
    });

    bookings.forEach((b) => {
      if (!b.zip_code) return;
      const c = zipCentroids[b.zip_code];
      if (!c) return;
      // Stable jitter — derived from the booking ID so pins don't
      // walk around the map when the data refreshes.
      const seed = hashStringToUnit(b.id);
      const jitter = 0.005;
      const lat = c.lat + (seed.x - 0.5) * jitter;
      const lng = c.lng + (seed.y - 0.5) * jitter;
      out.push({
        id: `booking-${b.id}`,
        kind: "booking",
        lat,
        lng,
        color: BOOKING_COLOR[b.status || ""] || "#3b82f6",
        title: `#${b.booking_number || b.id.slice(0, 6)} · ${[b.first_name, b.last_name].filter(Boolean).join(" ")}`,
        subtitle: `${b.service_date || "—"} · ${b.service_type || ""} · ${b.city || ""} ${b.zip_code || ""}`,
      });
    });

    // Apploye live GPS pings (magenta, larger). Plotted on top so the
    // operator can spot live cleaner positions vs. their declared
    // home base.
    apployePings.forEach((p) => {
      if (p.lat == null || p.lng == null) return;
      out.push({
        id: `apploye-${p.cleanerId || p.cleanerName || Math.random()}`,
        kind: "gps",
        lat: p.lat,
        lng: p.lng,
        color: p.status === "clocked_in" ? "#a855f7" : "#94a3b8",
        title: `${p.cleanerName || "Cleaner"} · ${p.status}`,
        subtitle: `Last ping: ${p.pingedAt ? new Date(p.pingedAt).toLocaleTimeString() : "—"}${p.activeBookingNumber ? ` · on NVC-${String(p.activeBookingNumber).padStart(4, "0")}` : ""}`,
      });
    });

    return out;
  }, [cleaners, bookings, zipCentroids, apployePings]);

  // ─── Sync pins → markers ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !mapsAvailable) return;
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    const bounds = new (window as any).google.maps.LatLngBounds();
    pins.forEach((p) => {
      const marker = new (window as any).google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current,
        title: p.title,
        icon: {
          path: (window as any).google.maps.SymbolPath.CIRCLE,
          scale: p.kind === "cleaner" ? 10 : 6,
          fillColor: p.color,
          fillOpacity: 0.9,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });
      const info = new (window as any).google.maps.InfoWindow({
        content: `<div style="font-family:Inter,sans-serif;color:#0f172a;padding:2px 4px;max-width:260px"><strong>${escapeHtml(p.title)}</strong><br/><span style="color:#64748b;font-size:12px">${escapeHtml(p.subtitle)}</span></div>`,
      });
      marker.addListener("click", () => info.open(mapRef.current, marker));
      bounds.extend({ lat: p.lat, lng: p.lng });
      markersRef.current.push(marker);
    });
    if (pins.length > 0) mapRef.current.fitBounds(bounds, 60);
  }, [pins, mapsAvailable]);

  // ─── Cross-reference: top zips + coverage gaps + capacity ──────────────
  const insight = useMemo(() => {
    const byZip: Record<string, { bookings: number; revenueCents: number }> = {};
    bookings.forEach((b) => {
      const z = b.zip_code;
      if (!z) return;
      byZip[z] = byZip[z] || { bookings: 0, revenueCents: 0 };
      byZip[z].bookings += 1;
      byZip[z].revenueCents += b.total_estimate_cents || 0;
    });

    const cleanerByZip: Record<string, CleanerRow[]> = {};
    cleaners.forEach((c) => {
      const zips = new Set<string>();
      if (c.home_zip) zips.add(c.home_zip);
      (c.service_zip_codes || []).forEach((z) => z && zips.add(z));
      zips.forEach((z) => {
        cleanerByZip[z] = cleanerByZip[z] || [];
        cleanerByZip[z].push(c);
      });
    });

    const topZips = Object.entries(byZip)
      .map(([zip, v]) => ({
        zip,
        bookings: v.bookings,
        revenueCents: v.revenueCents,
        cleaners: (cleanerByZip[zip] || []).filter((c) => (c.status || "").toLowerCase() === "active").length,
      }))
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 8);

    const gaps = Object.entries(byZip)
      .filter(
        ([zip, v]) =>
          v.bookings >= 2 &&
          !(cleanerByZip[zip] || []).some((c) => (c.status || "").toLowerCase() === "active"),
      )
      .map(([zip, v]) => ({ zip, bookings: v.bookings, revenueCents: v.revenueCents }))
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 6);

    return { topZips, gaps };
  }, [bookings, cleaners]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="font-jakarta text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <RiMapPin2Line className="w-6 h-6 text-violet-700" />
            Operational map
          </h1>
          <p className="text-sm text-slate-500">
            Cleaner coverage cross-referenced with the next 14 days of bookings. Coverage gaps surface zips you should recruit in.
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading} className="border-slate-200">
          <RiRefreshLine className={cn("w-4 h-4 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 order-2 lg:order-1">
          {mapsAvailable === false ? (
            <Card className="border-amber-200 bg-amber-50 h-[560px] flex items-center justify-center">
              <CardContent className="text-center py-12 max-w-md">
                <RiMapPin2Line className="w-10 h-10 text-amber-600 mx-auto mb-2" />
                <p className="text-amber-900 font-medium">Google Maps unavailable</p>
                {mapsAuthError ? (
                  <p className="text-xs text-amber-900/90 mt-2 leading-relaxed">
                    {mapsAuthError}
                  </p>
                ) : (
                  <p className="text-xs text-amber-800 mt-1">
                    Make sure the <code>GOOGLE_PLACES_API_KEY</code> Edge-Function
                    secret is set, the Maps JavaScript API is enabled in your GCP
                    project, and HTTP-referrer restrictions allow{" "}
                    <code>*.novaracleaning.com/*</code>.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-2xl overflow-hidden border border-slate-200" style={{ height: 560 }}>
              <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
            </div>
          )}
          <div className="flex items-center gap-3 text-[11px] text-slate-600 mt-3 px-1 flex-wrap">
            <Legend dot="#10b981" label="Active cleaner / confirmed booking" />
            <Legend dot="#f59e0b" label="Pending" />
            <Legend dot="#3b82f6" label="Completed booking" />
            <Legend dot="#a855f7" label="Apploye GPS (clocked in)" />
            <Legend dot="#94a3b8" label="Inactive / no slot" />
          </div>
          {apployeConfigured === false && (
            <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-[12px] text-sky-900">
              <p className="font-semibold mb-0.5">Apploye live tracking is not configured yet.</p>
              <p>
                Set <code>APPLOYE_API_KEY</code> and{" "}
                <code>APPLOYE_WORKSPACE_ID</code> in <em>app_secrets</em> (or
                Cursor Cloud-Agents → Secrets). Then invite each cleaner from
                the Cleaners tab — once they install the app, their live GPS
                shows up on this map.
              </p>
            </div>
          )}
          {apployeConfigured && apployePings.length > 0 && (
            <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-3 text-[12px] text-purple-900">
              <p className="font-semibold mb-1">
                {apployePings.length} cleaner{apployePings.length === 1 ? "" : "s"} pinging live (Apploye)
              </p>
              <ul className="space-y-0.5">
                {apployePings.slice(0, 6).map((p) => (
                  <li key={p.cleanerId || p.cleanerName} className="flex justify-between">
                    <span>{p.cleanerName || "Unnamed"} · {p.status}</span>
                    <span className="text-purple-700">
                      {p.pingedAt ? new Date(p.pingedAt).toLocaleTimeString() : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-4 order-1 lg:order-2">
          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <RiTrophyLine className="w-4 h-4 text-violet-700" />
                Top booking ZIPs (next 14d)
              </CardTitle>
              <CardDescription>Where the demand actually is</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {loading ? (
                <Skeleton className="h-32 w-full" />
              ) : insight.topZips.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-3">
                  No upcoming bookings.
                </p>
              ) : (
                insight.topZips.map((z) => (
                  <div
                    key={z.zip}
                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-md bg-slate-50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900">{z.zip}</p>
                      <p className="text-[11px] text-slate-500">
                        {z.bookings} bookings · {dollars(z.revenueCents)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-medium border",
                        z.cleaners > 0
                          ? "bg-violet-50 text-violet-700 border-violet-200"
                          : "bg-rose-50 text-rose-700 border-rose-200",
                      )}
                    >
                      {z.cleaners} cleaner{z.cleaners === 1 ? "" : "s"}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-rose-200 bg-rose-50/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5 text-rose-800">
                <RiAlertLine className="w-4 h-4" />
                Coverage gaps
              </CardTitle>
              <CardDescription className="text-rose-700/80">
                ZIPs with bookings but zero active cleaners
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {loading ? (
                <Skeleton className="h-20 w-full" />
              ) : insight.gaps.length === 0 ? (
                <p className="text-xs text-violet-700 text-center py-3">
                  ✓ Every booking ZIP has at least one active cleaner.
                </p>
              ) : (
                insight.gaps.map((z) => (
                  <div
                    key={z.zip}
                    className="flex items-center justify-between text-sm px-3 py-2 rounded-md bg-white border border-rose-100"
                  >
                    <div>
                      <p className="font-medium text-rose-900">{z.zip}</p>
                      <p className="text-[11px] text-rose-700/80">
                        {z.bookings} bookings unstaffed · {dollars(z.revenueCents)}
                      </p>
                    </div>
                    <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-200 text-[10px]">
                      Recruit here
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <RiToolsLine className="w-4 h-4 text-slate-600" />
                Cleaner pins
              </CardTitle>
              <CardDescription>
                {cleaners.length} cleaners plotted ·{" "}
                <RiCalendarCheckLine className="w-3 h-3 inline -mt-0.5" />{" "}
                {bookings.length} upcoming bookings
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dot }} />
      {label}
    </span>
  );
}

const dollars = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Cheap deterministic hash → two values in [0,1) used to jitter pins in
// the same ZIP without redrawing them on every refresh.
function hashStringToUnit(s: string): { x: number; y: number } {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0xdeadbeef >>> 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ch, 0x85ebca6b) >>> 0;
  }
  return {
    x: (h1 % 1000) / 1000,
    y: (h2 % 1000) / 1000,
  };
}
