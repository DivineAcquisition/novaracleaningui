/**
 * TestimonialCard - Modern testimonial card with avatar and rating
 */

import { cn } from "@/lib/utils";
import { Star, Quote } from "lucide-react";

interface TestimonialCardProps {
  quote: string;
  name: string;
  role?: string;
  location?: string;
  rating?: number;
  avatar?: string;
  className?: string;
  variant?: "default" | "gradient" | "minimal";
}

export function TestimonialCard({ 
  quote, 
  name, 
  role,
  location, 
  rating = 5,
  avatar,
  className,
  variant = "default"
}: TestimonialCardProps) {
  const variants = {
    default: "bg-card border-2",
    gradient: "bg-gradient-to-br from-white to-purple-50/50 border",
    minimal: "bg-transparent border-0",
  };

  // Generate initials for avatar fallback
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase();

  return (
    <div className={cn(
      "relative overflow-hidden rounded-2xl p-6 md:p-8 transition-all duration-300 hover:shadow-xl",
      variants[variant],
      className
    )}>
      {/* Decorative quote icon */}
      <Quote className="absolute top-4 right-4 w-8 h-8 text-[#5500FF]/10" />
      
      {/* Rating */}
      {rating > 0 && (
        <div className="flex gap-0.5 mb-4">
          {[...Array(5)].map((_, i) => (
            <Star 
              key={i} 
              className={cn(
                "w-4 h-4",
                i < rating ? "fill-yellow-400 text-yellow-400" : "fill-gray-200 text-gray-200"
              )} 
            />
          ))}
        </div>
      )}
      
      {/* Quote */}
      <p className="text-muted-foreground mb-6 leading-relaxed text-sm md:text-base">
        "{quote}"
      </p>
      
      {/* Author */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center text-white font-semibold text-sm">
          {avatar ? (
            <img src={avatar} alt={name} className="w-full h-full rounded-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <div>
          <p className="font-semibold text-sm md:text-base">{name}</p>
          <p className="text-xs md:text-sm text-muted-foreground">
            {role || location}
          </p>
        </div>
      </div>
    </div>
  );
}
