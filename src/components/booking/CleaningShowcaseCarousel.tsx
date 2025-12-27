import { useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";

const showcaseImages = [
  {
    id: 1,
    before: "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=400&h=300&fit=crop",
    after: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=300&fit=crop",
    label: "Kitchen Deep Clean"
  },
  {
    id: 2,
    before: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=400&h=300&fit=crop",
    after: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
    label: "Living Room Refresh"
  },
  {
    id: 3,
    before: "https://images.unsplash.com/photo-1620626011761-996317b8d101?w=400&h=300&fit=crop",
    after: "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=400&h=300&fit=crop",
    label: "Bathroom Sparkle"
  },
];

export function CleaningShowcaseCarousel() {
  const [emblaRef] = useEmblaCarousel(
    { loop: true, align: "center" },
    [Autoplay({ delay: 4000, stopOnInteraction: false })]
  );

  return (
    <div className="w-full overflow-hidden rounded-xl" ref={emblaRef}>
      <div className="flex">
        {showcaseImages.map((image) => (
          <div key={image.id} className="flex-[0_0_100%] min-w-0 px-2">
            <div className="relative rounded-lg overflow-hidden aspect-video bg-muted">
              <img
                src={image.after}
                alt={image.label}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                <p className="text-white font-medium text-sm">{image.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
