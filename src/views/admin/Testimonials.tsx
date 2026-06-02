"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RiDownloadLine, RiRefreshLine, RiShieldStarLine, RiVideoLine } from "@remixicon/react";
import { toast } from "sonner";

interface TestimonialOffer {
  id: string;
  booking_id: string;
  customer_email: string;
  customer_first_name: string | null;
  promo_code: string;
  status: string;
  video_url: string | null;
  answer_what_stood_out: string | null;
  answer_results: string | null;
  answer_recommend: string | null;
  submitted_at: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  submitted: "bg-violet-100 text-violet-800 border-violet-200",
  redeemed: "bg-violet-100 text-violet-800 border-violet-200",
};

export default function AdminTestimonials() {
  const [rows, setRows] = useState<TestimonialOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"submitted" | "all">("submitted");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // testimonial_offers isn't in the generated types — cast the builder.
      // deno-lint-ignore no-explicit-any
      let q = (supabase.from as any)("testimonial_offers")
        .select(
          "id, booking_id, customer_email, customer_first_name, promo_code, status, video_url, answer_what_stood_out, answer_results, answer_recommend, submitted_at, created_at",
        )
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (filter === "submitted") q = q.in("status", ["submitted", "redeemed"]);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data as TestimonialOffer[]) || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load testimonials");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (row: TestimonialOffer) => {
    if (!row.video_url) return;
    try {
      const res = await fetch(row.video_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `novara-testimonial-${row.customer_first_name || row.customer_email}-${row.id.slice(0, 8)}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fall back to opening the file directly.
      window.open(row.video_url, "_blank");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-jakarta text-2xl font-extrabold flex items-center gap-2">
            <RiShieldStarLine className="w-6 h-6 text-violet-600" />
            Testimonials
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Customer video reviews submitted after a completed clean.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={filter === "submitted" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("submitted")}
          >
            With video
          </Button>
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            All offers
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RiRefreshLine className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <RiVideoLine className="w-10 h-10 mx-auto mb-3 text-violet-400" />
            No testimonials yet. They appear here once customers submit a video after their clean.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((row) => (
            <Card key={row.id} className="border-violet-100">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {row.customer_first_name || row.customer_email}
                  </CardTitle>
                  <Badge variant="outline" className={STATUS_STYLES[row.status] || ""}>
                    {row.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.customer_email}
                  {row.submitted_at
                    ? ` · ${new Date(row.submitted_at).toLocaleDateString()}`
                    : ""}
                  {` · ${row.promo_code}`}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {row.video_url ? (
                  <>
                    <video
                      src={row.video_url}
                      controls
                      className="w-full rounded-lg bg-black max-h-72"
                      preload="metadata"
                    />
                    <Button onClick={() => void download(row)} className="w-full" size="sm">
                      <RiDownloadLine className="w-4 h-4 mr-2" />
                      Download video
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Offer sent — awaiting the customer's video.
                  </p>
                )}
                {(row.answer_what_stood_out || row.answer_results || row.answer_recommend) && (
                  <div className="space-y-2 text-sm border-t pt-3">
                    {row.answer_what_stood_out && (
                      <p>
                        <span className="font-semibold">Stood out:</span> {row.answer_what_stood_out}
                      </p>
                    )}
                    {row.answer_results && (
                      <p>
                        <span className="font-semibold">Results:</span> {row.answer_results}
                      </p>
                    )}
                    {row.answer_recommend && (
                      <p>
                        <span className="font-semibold">Recommend:</span> {row.answer_recommend}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
