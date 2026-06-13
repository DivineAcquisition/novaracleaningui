// Shared cleaner ranking for a booking (proximity + availability).

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface RankedCleaner {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  distance_miles: number | null;
  match_score: number;
  available: boolean;
  reason?: string;
}

export function scoreCleanerForJob(
  cleaner: {
    home_lat?: number | null;
    home_lng?: number | null;
    average_rating?: number | null;
    total_ratings?: number | null;
    workload_score?: number | null;
    acceptance_rate?: number | null;
    on_time_rate?: number | null;
    preferred_work_days?: string[] | null;
    max_travel_miles?: number | null;
    upcoming_jobs_count?: number | null;
    max_weekly_bookings?: number | null;
  },
  job: { lat: number; lng: number; weekday: string },
): {
  score: number;
  distance: number | null;
  available: boolean;
  reason?: string;
  worksToday?: boolean;
  breakdown?: {
    location: number;
    rating: number;
    workload: number;
    performance: number;
    works_today: boolean;
  };
} {
  const maxTravel = Number(cleaner.max_travel_miles) || 25;
  if (!cleaner.home_lat || !cleaner.home_lng) {
    return { score: 0, distance: null, available: false, reason: "missing_home_location" };
  }
  const distance = haversineMiles(cleaner.home_lat, cleaner.home_lng, job.lat, job.lng);
  if (distance > maxTravel) {
    return { score: 0, distance, available: false, reason: "too_far" };
  }
  const upcoming = Number(cleaner.upcoming_jobs_count) || 0;
  const maxWeekly = Number(cleaner.max_weekly_bookings) || 10;
  if (upcoming >= maxWeekly) {
    return { score: 0, distance, available: false, reason: "at_capacity" };
  }

  let locScore = 5;
  if (distance <= 5) locScore = 30;
  else if (distance <= 10) locScore = 25;
  else if (distance <= 15) locScore = 20;
  else if (distance <= 20) locScore = 15;
  else if (distance <= 25) locScore = 10;

  const rating = cleaner.average_rating;
  const ratings = cleaner.total_ratings;
  let ratingScore = 15;
  if (rating && ratings) {
    if (rating >= 5) ratingScore = 25;
    else if (rating >= 4.5) ratingScore = 22;
    else if (rating >= 4) ratingScore = 18;
    else ratingScore = 12;
  }

  const workload = Number(cleaner.workload_score) || 0;
  let workloadScore = 25;
  if (workload >= 8) workloadScore = 5;
  else if (workload >= 5) workloadScore = 10;
  else if (workload >= 3) workloadScore = 15;
  else if (workload >= 1) workloadScore = 20;

  // acceptance_rate / on_time_rate are stored as a 0-1 fraction.
  // Clamp defensively so any legacy 0-100 rows can't blow the
  // performance term past its intended 20-point ceiling.
  const accept = Math.min(1, Math.max(0, Number(cleaner.acceptance_rate) || 0));
  const onTime = Math.min(1, Math.max(0, Number(cleaner.on_time_rate) || 0));
  const perfScore = Math.round(accept * 10 + onTime * 10);

  const prefs = cleaner.preferred_work_days || [];
  const worksToday = prefs.length === 0 || prefs.includes(job.weekday);

  let total = locScore + ratingScore + workloadScore + perfScore;
  if (!worksToday) {
    total = Math.round(total * 0.9);
  }
  return {
    score: total,
    distance,
    available: true,
    worksToday,
    breakdown: {
      location: locScore,
      rating: ratingScore,
      workload: workloadScore,
      performance: perfScore,
      works_today: worksToday,
    },
  };
}
