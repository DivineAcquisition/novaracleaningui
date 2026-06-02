"use client";

import { useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel";

// Drop the uploaded photos into /public/zip-gallery/ with these filenames.
// The carousel auto-hides any image that fails to load, so it renders
// nothing until the assets are added.
const IMAGES = [
  { src: "/zip-gallery/photo-1.jpg", alt: "Novara cleaning result" },
  { src: "/zip-gallery/photo-2.jpg", alt: "Novara cleaning result" },
];

export function ZipGallery() {
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const images = IMAGES.filter((img) => !broken[img.src]);

  if (images.length === 0) return null;

  return (
    <section className="container mx-auto px-4 pb-12">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-center font-jakarta text-xl md:text-2xl font-bold mb-4">
          See the Novara difference
        </h2>
        <Carousel className="w-full" opts={{ loop: true }}>
          <CarouselContent>
            {images.map((img) => (
              <CarouselItem key={img.src}>
                <div className="overflow-hidden rounded-2xl border shadow-card bg-muted">
                  <img
                    src={img.src}
                    alt={img.alt}
                    loading="lazy"
                    className="w-full h-72 md:h-96 object-cover"
                    onError={() => setBroken((b) => ({ ...b, [img.src]: true }))}
                  />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          {images.length > 1 && (
            <>
              <CarouselPrevious />
              <CarouselNext />
            </>
          )}
        </Carousel>
      </div>
    </section>
  );
}
