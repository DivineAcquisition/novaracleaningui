export interface TimeSlot {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  estimatedDuration: number;
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

export function generateTimeSlots(serviceDuration: number, _serviceType: string): TimeSlot[] {
  // IMPORTANT: the IDs returned here MUST match the IDs the main booking
  // funnel writes into `bookings.time_slot`. SchedulePicker (used during
  // checkout) writes hourly-window IDs like "9:00 AM - 10:00 AM" — so
  // reschedule MUST emit the same IDs, otherwise the rescheduled row
  // becomes unjoinable to its old availability slot, the inbound webhook
  // can't pretty-print the time, and downstream Zapier/GHL syncs receive
  // a different shape than other bookings.
  //
  // We generate every hourly start from 8 AM to 5 PM (so the latest
  // bookable visit starts at 5 PM). serviceDuration only affects the
  // `estimatedDuration` field for the UI label — it does NOT change the
  // slot id.
  const baseStartTimes = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  const slots: TimeSlot[] = [];
  for (const startTime of baseStartTimes) {
    const endTime = startTime + 1;
    slots.push({
      id: `${formatTime(startTime)} - ${formatTime(endTime)}`,
      label: formatTime(startTime),
      startTime: formatTime(startTime),
      endTime: formatTime(endTime),
      estimatedDuration: serviceDuration,
    });
  }
  return slots;
}

function formatTime(hour: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${displayHour}:00 ${period}`;
}

function formatTimeSlot(start: number, end: number): string {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

export function calculateServiceDuration(
  homeSizeId: string,
  serviceType: string,
  baseHours: number
): number {
  // Standard: use 2 hours fixed
  if (serviceType === 'standard') {
    return 2;
  }
  
  // Deep Cleaning & Move In/Out: use 4 hours fixed
  if (serviceType === 'deep' || serviceType === 'moveInOut') {
    return 4;
  }
  
  return 2;
}
