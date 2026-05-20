"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { loadGooglePlaces } from "@/lib/google-places-loader";
import AdminLayout from "@/components/admin/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { RiMapPinLine, RiUserAddLine, RiCalendarCheckLine, RiToolsLine, RiRefreshLine } from "@remixicon/react";

interface Pin {
  id: string;
  lat: number;
  lng: number;
  kind: "booking" | "cleaner" | "lead";
  color: string;
  title: string;
  subtitle: string;
  data: any;
}

interface BookingRow {
  id: string;
  booking_number: number | null;
  service_date: string;
  time_slot: string | null;
  status: string;
  service_type: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  total_estimate_cents: number | null;
  first_name: string | null;
  last_name: string | null;
}

interface CleanerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  home_lat: number | null;
  home_lng: number | null;
  home_zip: string | null;
  status: string;
  pay_tier: string | null;
  average_rating: number | null;
}

interface LeadRow {
  id: string;
  first_name: string;
  last_name: string;
  status: string;
  zip_code: string | null;
  source: string;
  created_at: string;
}

const BOOKING_COLOR: Record<string, string> = {
  booked: "#3b82f6",
  confirmed: "#10b981",
  pending_details: "#f59e0b",
  completed: "#fbbf24",
  cancelled: "#ef4444",
  in_progress: "#8b5cf6",
};

const LEAD_COLOR: Record<string, string> = {
  new: "#3b82f6",
  contacted: "#f59e0b",
  replied: "#10b981",
  booked: "#10b981",
  lost: "#94a3b8",
};

const DEFAULT_CENTER = { lat: 39.0458, lng: -76.6413 }; // Baltimore, MD (Novara HQ area)

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const { data, error } = await supabase.functions.invoke("geocode-address", { body: { address } });
    if (error || !data) return null;
    if (typeof data.lat === "number" && typeof data.lng === "number") return { lat: data.lat, lng: data.lng };
    return null;
  } catch {
    return null;
  }
}

// Rough zip-code centroid lookup for common Novara service ZIPs. Used as a
// last resort when a lead has only a zip code with no full address.
const ZIP_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  // Maryland — DMV
  "20814": { lat: 38.9847, lng: -77.0947 },
  "20815": { lat: 38.9847, lng: -77.0739 },
  "20816": { lat: 38.9525, lng: -77.0903 },
  "20817": { lat: 39.0042, lng: -77.1503 },
  "20850": { lat: 39.0939, lng: -77.2197 },
  "20852": { lat: 39.0511, lng: -77.1167 },
  "20854": { lat: 39.0211, lng: -77.2153 },
  "21210": { lat: 39.3508, lng: -76.6322 },
  "21218": { lat: 39.3258, lng: -76.5963 },
  "21230": { lat: 39.2719, lng: -76.6262 },
  "21401": { lat: 38.9783, lng: -76.4922 },
  "21701": { lat: 39.4144, lng: -77.4108 },
};

export default function AdminMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Array<google.maps.Marker>>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "bookings" | "cleaners" | "leads">("all");
  const [mapsAvailable, setMapsAvailable] = useState<boolean | null>(null);
  const [selectedPin, setSelectedPin] = useState<Pin | null>(null);

  const buildPins = useCallback(async () => {
    setLoading(true);
    const next: Pin[] = [];

    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

    const [{ data: bookings }, { data: cleaners }, { data: leads }] = await Promise.all([
      supabase.from("bookings").select("id, booking_number, service_date, time_slot, status, service_type, address, city, state, zip_code, total_estimate_cents, first_name, last_name").gte("service_date", today).lte("service_date", horizon).neq("status", "cancelled").limit(100),
      supabase.from("cleaners").select("id, first_name, last_name, home_lat, home_lng, home_zip, status, pay_tier, average_rating" as string).eq("status", "active"),
      supabase.from("leads").select("id, first_name, last_name, status, zip_code, source, created_at").gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()).limit(100),
    ]);

    for (const c of (cleaners as unknown as CleanerRow[] | null) || []) {
      let lat = c.home_lat;
      let lng = c.home_lng;
      if ((lat == null || lng == null) && c.home_zip) {
        const z = ZIP_CENTROIDS[c.home_zip];
        if (z) { lat = z.lat; lng = z.lng; }
      }
      if (lat == null || lng == null) continue;
      next.push({
        id: `cleaner:${c.id}`, lat, lng, kind: "cleaner",
        color: "#a855f7",
        title: `${c.first_name || ""} ${c.last_name || ""}`,
        subtitle: `${c.pay_tier || "foundation"} • ${c.average_rating ?? "—"}★`,
        data: c,
      });
    }

    // Bookings: prefer zip centroid (fast); fall back to geocode in parallel.
    const bookingPromises: Promise<void>[] = [];
    for (const b of (bookings || []) as BookingRow[]) {
      const centroid = b.zip_code ? ZIP_CENTROIDS[b.zip_code] : null;
      if (centroid) {
        // jitter slightly so multiple bookings in the same zip don't overlap
        const jitter = () => (Math.random() - 0.5) * 0.008;
        next.push({
          id: `booking:${b.id}`, lat: centroid.lat + jitter(), lng: centroid.lng + jitter(), kind: "booking",
          color: BOOKING_COLOR[b.status] || "#3b82f6",
          title: `${b.first_name || ""} ${b.last_name || ""} • ${b.service_type || "cleaning"}`,
          subtitle: `${format(new Date(b.service_date + "T00:00:00"), "MMM d")} ${b.time_slot || ""} • ${b.status}`,
          data: b,
        });
      } else if (b.address && b.city) {
        const addr = `${b.address}, ${b.city}, ${b.state || "MD"} ${b.zip_code || ""}`;
        bookingPromises.push(
          geocodeAddress(addr).then((coords) => {
            if (coords) {
              next.push({
                id: `booking:${b.id}`, lat: coords.lat, lng: coords.lng, kind: "booking",
                color: BOOKING_COLOR[b.status] || "#3b82f6",
                title: `${b.first_name || ""} ${b.last_name || ""} • ${b.service_type || "cleaning"}`,
                subtitle: `${format(new Date(b.service_date + "T00:00:00"), "MMM d")} ${b.time_slot || ""} • ${b.status}`,
                data: b,
              });
            }
          })
        );
      }
    }

    for (const l of (leads || []) as LeadRow[]) {
      const centroid = l.zip_code ? ZIP_CENTROIDS[l.zip_code] : null;
      if (!centroid) continue;
      const jitter = () => (Math.random() - 0.5) * 0.008;
      next.push({
        id: `lead:${l.id}`, lat: centroid.lat + jitter(), lng: centroid.lng + jitter(), kind: "lead",
        color: LEAD_COLOR[l.status] || "#3b82f6",
        title: `${l.first_name} ${l.last_name}`,
        subtitle: `${l.status} • ${l.source}`,
        data: l,
      });
    }

    await Promise.allSettled(bookingPromises);
    setPins(next);
    setLoading(false);
  }, []);

  // Init google maps
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const places = await loadGooglePlaces();
      if (cancelled) return;
      if (!places || !window.google?.maps) {
        setMapsAvailable(false);
        return;
      }
      setMapsAvailable(true);
      if (containerRef.current && !mapRef.current) {
        mapRef.current = new window.google.maps.Map(containerRef.current, {
          center: DEFAULT_CENTER,
          zoom: 9,
          styles: [
            { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#0f172a" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c1626" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#334155" }] },
          ],
          disableDefaultUI: false,
          zoomControl: true,
        });
        infoRef.current = new window.google.maps.InfoWindow();
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { buildPins(); }, [buildPins]);

  // Sync pins to markers
  useEffect(() => {
    if (!mapRef.current || !mapsAvailable) return;
    // clear old
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    const filtered = filter === "all" ? pins : pins.filter((p) => p.kind === filter.slice(0, -1));
    const bounds = new window.google.maps.LatLngBounds();
    filtered.forEach((p) => {
      const marker = new window.google.maps.Marker({
        position: { lat: p.lat, lng: p.lng },
        map: mapRef.current!,
        title: p.title,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: p.kind === "cleaner" ? 9 : 7,
          fillColor: p.color, fillOpacity: 0.9,
          strokeColor: "#0f172a", strokeWeight: 2,
        },
      });
      marker.addListener("click", () => {
        setSelectedPin(p);
        infoRef.current?.setContent(`<div style="color:#0f172a;font-family:Inter,sans-serif;padding:4px"><strong>${p.title}</strong><br/><span style="font-size:12px">${p.subtitle}</span></div>`);
        infoRef.current?.open(mapRef.current!, marker);
      });
      bounds.extend({ lat: p.lat, lng: p.lng });
      markersRef.current.push(marker);
    });
    if (filtered.length > 0) mapRef.current.fitBounds(bounds, 60);
  }, [pins, filter, mapsAvailable]);

  // Realtime: when an event arrives, refresh
  useEffect(() => {
    const ch = supabase.channel("map-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, (payload) => {
        const r = payload.new as any;
        const interestingTypes = ["booking.created", "booking.status_change", "booking.completed", "booking.cancelled", "lead.created", "lead.status_change", "cleaner.deactivated", "cleaner.reactivated"];
        if (interestingTypes.includes(r.event_type)) {
          // Soft refresh — debounce by queueing
          buildPins();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [buildPins]);

  const counts = useMemo(() => ({
    bookings: pins.filter((p) => p.kind === "booking").length,
    cleaners: pins.filter((p) => p.kind === "cleaner").length,
    leads: pins.filter((p) => p.kind === "lead").length,
    total: pins.length,
  }), [pins]);

  return (
    <AdminLayout>
      <div className="space-y-4">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <RiMapPinLine className="w-6 h-6 text-amber-400" />
              Operational Map
            </h1>
            <p className="text-sm text-slate-400 mt-1">Live pins for bookings (next 14d), active cleaners, and recent leads. Auto-refreshes on every event.</p>
          </div>
          <Button onClick={buildPins} variant="outline" size="sm" className="border-white/10 text-slate-200 hover:bg-white/5">
            <RiRefreshLine className="w-4 h-4 mr-1" /> Refresh
          </Button>
        </header>

        <div className="grid grid-cols-4 gap-3">
          {[
            { k: "all", label: "All", count: counts.total, icon: RiMapPinLine },
            { k: "bookings", label: "Bookings", count: counts.bookings, icon: RiCalendarCheckLine },
            { k: "cleaners", label: "Cleaners", count: counts.cleaners, icon: RiToolsLine },
            { k: "leads", label: "Leads", count: counts.leads, icon: RiUserAddLine },
          ].map((s) => {
            const Icon = s.icon;
            const active = filter === (s.k as typeof filter);
            return (
              <button
                key={s.k}
                onClick={() => setFilter(s.k as typeof filter)}
                className={`text-left p-3 rounded-lg border transition-colors ${active ? "bg-amber-500/10 border-amber-500/40" : "bg-slate-900 border-white/10 hover:border-white/20"}`}
              >
                <div className="flex items-center justify-between">
                  <Icon className={`w-5 h-5 ${active ? "text-amber-400" : "text-slate-500"}`} />
                  <span className="text-xl font-bold text-white">{s.count}</span>
                </div>
                <p className="text-xs text-slate-400 uppercase mt-1">{s.label}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            {mapsAvailable === false ? (
              <Card className="bg-slate-900 border-amber-500/20 h-[600px] flex items-center justify-center">
                <CardContent className="text-center py-12">
                  <RiMapPinLine className="w-12 h-12 text-amber-400 mx-auto mb-3" />
                  <p className="text-white font-medium">Google Maps not available</p>
                  <p className="text-sm text-slate-400 mt-1">Add a Google Places API key in app_secrets to enable the map.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="bg-slate-900 border border-white/10 rounded-lg overflow-hidden" style={{ height: 600 }}>
                <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Card className="bg-slate-900 border-white/10">
              <CardHeader>
                <CardTitle className="text-white text-sm">Legend</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-purple-500" /> Cleaner (home base)</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-blue-500" /> Booked / New lead</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-emerald-500" /> Confirmed / Replied</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-violet-500" /> In progress</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-400" /> Completed</div>
                <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-red-500" /> Cancelled</div>
              </CardContent>
            </Card>

            {selectedPin ? (
              <Card className="bg-slate-900 border-amber-500/30">
                <CardHeader>
                  <CardTitle className="text-white text-sm flex items-center gap-2">
                    <Badge variant="outline" className="border-amber-500/30 text-amber-300 capitalize">{selectedPin.kind}</Badge>
                    {selectedPin.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-slate-400">{selectedPin.subtitle}</p>
                  <pre className="text-xs text-slate-300 bg-slate-950/50 p-2 rounded mt-2 overflow-x-auto">{JSON.stringify(selectedPin.data, null, 2)}</pre>
                </CardContent>
              </Card>
            ) : loading ? (
              <Skeleton className="h-48 bg-slate-800" />
            ) : (
              <Card className="bg-slate-900 border-white/10">
                <CardContent className="p-6 text-center text-sm text-slate-500">
                  Click a pin to see its details.
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
