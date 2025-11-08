export interface TimeSlot {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  estimatedDuration: number;
}

export function generateTimeSlots(serviceDuration: number, serviceType: string): TimeSlot[] {
  // Base start times available (in 24hr format)
  const baseStartTimes = [8, 10, 12, 14, 16, 18];
  
  // Filter times based on service duration to ensure completion before 8pm
  const maxEndTime = 20; // 8pm
  const slots: TimeSlot[] = [];
  
  for (const startTime of baseStartTimes) {
    const endTime = startTime + serviceDuration;
    
    // Only include if service can finish by 8pm
    if (endTime <= maxEndTime) {
      slots.push({
        id: `${startTime}-${endTime}`,
        label: formatTimeSlot(startTime, endTime),
        startTime: formatTime(startTime),
        endTime: formatTime(endTime),
        estimatedDuration: serviceDuration,
      });
    }
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
  // Standard: use base hours from home size
  if (serviceType === 'standard') {
    return baseHours;
  }
  
  // Deep Cleaning & Move In/Out: base hours + 2
  if (serviceType === 'deep' || serviceType === 'moveInOut') {
    return baseHours + 2;
  }
  
  return baseHours;
}
