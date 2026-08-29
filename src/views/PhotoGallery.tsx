"use client";

// ─── /photos/[token] — open before/after photo gallery ─────────────────────
//
// Public, login-free gallery customers (regular bookings) and partner hosts
// (STR turnovers) open from the completion SMS/email. The URL carries a single
// token that resolves to a specific job via the `get-job-photos` edge function.
//
// Mobile-first — almost always opened on a phone. No PII beyond first name +
// street/city of the serviced property.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCheckboxCircleFill,
  RiCloseLine,
  RiImage2Line,
  RiMapPinLine,
  RiPlayCircleLine,
  RiSparklingLine,
} from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { SEO } from "@/components/SEO";
import { MediaThumb } from "@/components/job-media/MediaThumb";
import { isVideoUrl } from "@/lib/job-media";
import { cn } from "@/lib/utils";

interface GalleryData {
  kind: "booking" | "turnover";
  title: string;
  customerFirstName: string | null;
  serviceDate: string | null;
  addressLine: string | null;
  cleanerFirstName: string | null;
  completedAt: string | null;
  beforePhotos: string[];
  afterPhotos: string[];
}

export default function PhotoGalleryPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");

  const [data, setData] = useState<GalleryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const { data, error } = await supabase.functions.invoke("get-job-photos", {
        body: { token },
      });
      if (error) throw error;
      const d = data as { ok?: boolean; reason?: string } & GalleryData;
      if (!d?.ok) {
        setLoadErr(d?.reason || "This photo link is no longer valid.");
        return;
      }
      setData(d);
    } catch (err) {
      setLoadErr((err as Error).message || "Couldn't load these photos.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void load();
  }, [token, load]);

  // Keyboard nav for the lightbox.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") setLightbox((lb) => lb && { ...lb, index: (lb.index + 1) % lb.urls.length });
      if (e.key === "ArrowLeft") setLightbox((lb) => lb && { ...lb, index: (lb.index - 1 + lb.urls.length) % lb.urls.length });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  if (loadErr || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <SEO title="Photo gallery" description="View your cleaning before & after photos." noindex />
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <RiImage2Line className="h-6 w-6" />
          </div>
          <p className="font-semibold text-slate-900">This photo link isn't available.</p>
          <p className="mt-1 text-sm text-slate-500">
            The link may have expired or the photos aren't ready yet. If you think this is a
            mistake, reply to the text you received or reach our team.
          </p>
          <a
            href="tel:+18447352070"
            className="mt-4 inline-block text-sm font-medium text-emerald-600 hover:underline"
          >
            Call (844) 735-2070
          </a>
        </div>
      </div>
    );
  }

  const totalPhotos = data.beforePhotos.length + data.afterPhotos.length;

  return (
    <div className="min-h-screen bg-background pb-16">
      <SEO title="Your cleaning photos" description="Before & after photos from your Novara clean." noindex />

      <header className="bg-gradient-to-br from-emerald-600 to-teal-500 text-white">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <div className="flex items-center gap-2">
            <img src="/novara-logo.png" alt="Novara" className="h-8 w-8 rounded-lg shadow-sm" />
            <span className="text-sm font-semibold tracking-wide">Novara Cleaning</span>
          </div>
          <div className="mt-4 flex items-start gap-2">
            <RiSparklingLine className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div>
              <h1 className="text-lg font-bold leading-tight">{data.title}</h1>
              <p className="mt-1 text-xs text-emerald-50">
                {data.completedAt && (
                  <span className="inline-flex items-center gap-1">
                    <RiCheckboxCircleFill className="h-3.5 w-3.5" /> Completed
                  </span>
                )}
                {data.cleanerFirstName && (
                  <span> · Cleaned by {data.cleanerFirstName}</span>
                )}
              </p>
              {data.addressLine && (
                <p className="mt-1 flex items-center gap-1 text-xs text-emerald-50/90">
                  <RiMapPinLine className="h-3.5 w-3.5" /> {data.addressLine}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        {totalPhotos === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <RiImage2Line className="mx-auto mb-2 h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">Photos haven't been uploaded yet. Check back soon.</p>
          </div>
        ) : (
          <>
            <PhotoSection
              label="Before"
              accent="text-slate-700"
              urls={data.beforePhotos}
              onOpen={(index) => setLightbox({ urls: data.beforePhotos, index })}
            />
            <PhotoSection
              label="After"
              accent="text-emerald-700"
              urls={data.afterPhotos}
              onOpen={(index) => setLightbox({ urls: data.afterPhotos, index })}
            />
          </>
        )}

        <p className="text-center text-xs text-slate-400">
          Questions about your clean?{" "}
          <a href="tel:+18447352070" className="text-emerald-600 hover:underline">
            Call (844) 735-2070
          </a>
        </p>
      </div>

      {lightbox && (
        <Lightbox
          urls={lightbox.urls}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNav={(dir) =>
            setLightbox((lb) =>
              lb && { ...lb, index: (lb.index + dir + lb.urls.length) % lb.urls.length },
            )
          }
        />
      )}
    </div>
  );
}

function PhotoSection({
  label,
  accent,
  urls,
  onOpen,
}: {
  label: string;
  accent: string;
  urls: string[];
  onOpen: (index: number) => void;
}) {
  if (urls.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className={cn("text-sm font-bold uppercase tracking-widest", accent)}>{label}</h2>
        <span className="text-xs text-slate-400">{urls.length} file{urls.length === 1 ? "" : "s"}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {urls.map((u, i) => (
          <button
            key={u}
            type="button"
            onClick={() => onOpen(i)}
            className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
          >
            <MediaThumb
              url={u}
              alt={`${label} ${i + 1}`}
              className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
            />
            {isVideoUrl(u) && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                <RiPlayCircleLine className="h-10 w-10 text-white drop-shadow" />
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function Lightbox({
  urls,
  index,
  onClose,
  onNav,
}: {
  urls: string[];
  index: number;
  onClose: () => void;
  onNav: (dir: number) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Close"
      >
        <RiCloseLine className="h-6 w-6" />
      </button>
      {urls.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNav(-1);
            }}
            className="absolute left-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Previous"
          >
            <RiArrowLeftSLine className="h-7 w-7" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNav(1);
            }}
            className="absolute right-3 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Next"
          >
            <RiArrowRightSLine className="h-7 w-7" />
          </button>
        </>
      )}
      {isVideoUrl(urls[index]) ? (
        <video
          src={urls[index]}
          controls
          playsInline
          autoPlay
          className="max-h-[85vh] max-w-full rounded-lg"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img
          src={urls[index]}
          alt={`Photo ${index + 1}`}
          className="max-h-[85vh] max-w-full rounded-lg object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}
      {urls.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
          {index + 1} / {urls.length}
        </div>
      )}
    </div>
  );
}
