import { Star } from "lucide-react";

const reviews = [
  {
    id: 1,
    name: "Sarah M.",
    rating: 5,
    text: "Best cleaning service I've ever used! My home has never looked better.",
    date: "2 weeks ago"
  },
  {
    id: 2,
    name: "Michael R.",
    rating: 5,
    text: "Professional, thorough, and always on time. Highly recommend!",
    date: "1 month ago"
  },
  {
    id: 3,
    name: "Jennifer L.",
    rating: 5,
    text: "The team was incredible. They paid attention to every detail.",
    date: "3 weeks ago"
  },
];

export function ReviewsWidget() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">What Our Customers Say</h3>
        <div className="flex items-center gap-1">
          <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
          <span className="text-sm font-medium">4.9</span>
          <span className="text-sm text-muted-foreground">(500+ reviews)</span>
        </div>
      </div>

      <div className="space-y-3">
        {reviews.map((review) => (
          <div 
            key={review.id} 
            className="bg-card border border-border rounded-lg p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-medium text-primary">
                    {review.name.charAt(0)}
                  </span>
                </div>
                <span className="font-medium text-foreground">{review.name}</span>
              </div>
              <div className="flex items-center gap-0.5">
                {Array.from({ length: review.rating }).map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                ))}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{review.text}</p>
            <p className="text-xs text-muted-foreground">{review.date}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
