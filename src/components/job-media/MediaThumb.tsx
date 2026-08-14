"use client";

import { isVideoUrl } from "@/lib/job-media";
import { cn } from "@/lib/utils";

export function MediaThumb({
  url,
  alt,
  className,
}: {
  url: string;
  alt?: string;
  className?: string;
}) {
  if (isVideoUrl(url)) {
    return (
      <video
        src={`${url}#t=0.1`}
        className={cn("bg-slate-900 object-cover", className)}
        muted
        playsInline
        preload="metadata"
        aria-label={alt || "Video"}
      />
    );
  }
  return <img src={url} alt={alt || ""} className={className} />;
}
