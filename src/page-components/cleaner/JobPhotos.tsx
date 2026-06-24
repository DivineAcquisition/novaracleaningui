"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import imageCompression from "browser-image-compression";
import {
  Loader2,
  Camera,
  ImagePlus,
  CheckCircle2,
  Calendar,
  MapPin,
  ArrowLeft,
  X,
} from "lucide-react";

interface JobBooking {
  id: string;
  first_name: string;
  last_name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  service_type: string;
  service_date: string;
  status: string | null;
  before_photos: string[] | null;
  after_photos: string[] | null;
}

type PhotoType = "before" | "after";

export default function JobPhotos() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get("booking_id");

  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState<JobBooking | null>(null);
  const [uploading, setUploading] = useState<PhotoType | null>(null);

  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBooking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  const loadBooking = async () => {
    if (!bookingId) {
      setLoading(false);
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push(`/cleaner/auth?returnTo=/cleaner/job-photos?booking_id=${bookingId}`);
        return;
      }

      const { data, error } = await supabase
        .from("bookings")
        .select(
          "id, first_name, last_name, address, city, state, zip_code, service_type, service_date, status, before_photos, after_photos"
        )
        .eq("id", bookingId)
        .maybeSingle();

      if (error) throw error;
      setBooking(data as JobBooking);
    } catch (error) {
      console.error("Error loading booking:", error);
      toast.error("Failed to load job details");
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: PhotoType
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !booking) return;

    setUploading(type);
    try {
      const uploadedUrls: string[] = [];

      for (const file of Array.from(files)) {
        const compressed = await imageCompression(file, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        });

        const fileName = `${booking.id}/${type}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.jpg`;

        const { data, error } = await supabase.storage
          .from("job-photos")
          .upload(fileName, compressed, {
            contentType: "image/jpeg",
            upsert: false,
          });

        if (error) throw error;

        const { data: { publicUrl } } = supabase.storage
          .from("job-photos")
          .getPublicUrl(data.path);

        uploadedUrls.push(publicUrl);
      }

      const column = type === "before" ? "before_photos" : "after_photos";
      const existing = (type === "before" ? booking.before_photos : booking.after_photos) || [];
      const updatedPhotos = [...existing, ...uploadedUrls];

      const { error: updateError } = await supabase
        .from("bookings")
        .update({
          [column]: updatedPhotos,
          photos_submitted_at: new Date().toISOString(),
        })
        .eq("id", booking.id);

      if (updateError) throw updateError;

      setBooking({ ...booking, [column]: updatedPhotos });
      toast.success(
        `${uploadedUrls.length} ${type} photo${uploadedUrls.length > 1 ? "s" : ""} uploaded`
      );
    } catch (error) {
      console.error("Error uploading photo:", error);
      toast.error("Failed to upload photo. Please try again.");
    } finally {
      setUploading(null);
      // Reset input so the same file can be re-selected
      if (type === "before" && beforeInputRef.current) beforeInputRef.current.value = "";
      if (type === "after" && afterInputRef.current) afterInputRef.current.value = "";
    }
  };

  const removePhoto = async (url: string, type: PhotoType) => {
    if (!booking) return;
    try {
      const column = type === "before" ? "before_photos" : "after_photos";
      const existing = (type === "before" ? booking.before_photos : booking.after_photos) || [];
      const updatedPhotos = existing.filter((p) => p !== url);

      const { error } = await supabase
        .from("bookings")
        .update({ [column]: updatedPhotos })
        .eq("id", booking.id);

      if (error) throw error;

      setBooking({ ...booking, [column]: updatedPhotos });
      toast.success("Photo removed");
    } catch (error) {
      console.error("Error removing photo:", error);
      toast.error("Failed to remove photo");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading job details...</p>
        </div>
      </div>
    );
  }

  if (!bookingId || !booking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center px-4">
        <Card className="max-w-md w-full border-0 shadow-lg">
          <CardHeader className="text-center">
            <CardTitle>Job Not Found</CardTitle>
            <CardDescription>
              We couldn&apos;t find that job. Please use the link from your text message,
              or open it from your dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => router.push("/cleaner/dashboard")}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const renderPhotoSection = (type: PhotoType) => {
    const photos = (type === "before" ? booking.before_photos : booking.after_photos) || [];
    const inputRef = type === "before" ? beforeInputRef : afterInputRef;
    const isUploading = uploading === type;

    return (
      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg capitalize flex items-center gap-2">
              <Camera className="w-5 h-5 text-primary" />
              {type} Photos
            </CardTitle>
            {photos.length > 0 && (
              <Badge variant="secondary" className="bg-green-500/10 text-green-600 border-0">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                {photos.length}
              </Badge>
            )}
          </div>
          <CardDescription>
            {type === "before"
              ? "Photos of the home before you started cleaning"
              : "Photos showing the completed work"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((url) => (
                <div key={url} className="relative aspect-square rounded-lg overflow-hidden group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`${type} photo`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(url, type)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remove photo"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelected(e, type)}
          />
          <Button
            variant="outline"
            className="w-full h-12 border-dashed"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <ImagePlus className="w-4 h-4 mr-2" />
                Add {type} photo
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  };

  const totalPhotos =
    (booking.before_photos?.length || 0) + (booking.after_photos?.length || 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/cleaner/dashboard")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <p className="font-semibold text-sm">Submit Job Photos</p>
            <p className="text-xs text-muted-foreground">Upload before & after pictures</p>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Job details */}
        <Card className="border-0 shadow-lg">
          <CardContent className="p-5 space-y-2">
            <h1 className="text-lg font-bold">{booking.service_type}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>
                {new Date(booking.service_date).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="w-4 h-4" />
              <span>
                {booking.address}, {booking.city}, {booking.state} {booking.zip_code}
              </span>
            </div>
          </CardContent>
        </Card>

        {totalPhotos > 0 && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
            <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-700">
              {totalPhotos} photo{totalPhotos > 1 ? "s" : ""} submitted. You can add or remove
              photos anytime.
            </p>
          </div>
        )}

        {renderPhotoSection("before")}
        {renderPhotoSection("after")}

        <Button className="w-full h-12" onClick={() => router.push("/cleaner/dashboard")}>
          Done
        </Button>

        <p className="text-xs text-center text-muted-foreground px-4">
          Tip: Take clear, well-lit photos of each room before and after cleaning.
        </p>
      </main>
    </div>
  );
}
