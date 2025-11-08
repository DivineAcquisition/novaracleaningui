export interface TimeSlot {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  duration: number;
}

/**
 * Generates time slots based on service duration
 * Standard (2-3 hrs): More slots available (8am-6pm)
 * Deep (4-5 hrs): Fewer slots (8am-4pm)
 * Move In/Out (4-6 hrs): Even fewer slots (8am-2pm)
 */
export function generateTimeSlots(serviceDuration: number, serviceType: string): TimeSlot[] {
  const slots: TimeSlot[] = [];
  
  // Determine available start times based on service type
  let startTimes: number[];
  
  if (serviceType === 'moveInOut') {
    // Longest services: 8am, 10am, 12pm, 2pm
    startTimes = [8, 10, 12, 14];
  } else if (serviceType === 'deep') {
    // Medium services: 8am, 10am, 12pm, 2pm, 4pm
    startTimes = [8, 10, 12, 14, 16];
  } else {
    // Standard services: 8am, 10am, 12pm, 2pm, 4pm, 6pm
    startTimes = [8, 10, 12, 14, 16, 18];
  }

  startTimes.forEach(startHour => {
    const endHour = startHour + Math.ceil(serviceDuration);
    const endMinutes = (serviceDuration % 1) * 60;
    
    const startLabel = formatTime(startHour, 0);
    const endLabel = formatTime(endHour, endMinutes);
    
    slots.push({
      id: `${startHour}:00`,
      label: `${startLabel} - ${endLabel}`,
      startTime: `${startHour}:00`,
      endTime: `${endHour}:${endMinutes.toString().padStart(2, '0')}`,
      duration: serviceDuration,
    });
  });

  return slots;
}

function formatTime(hour: number, minutes: number = 0): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const displayMinutes = minutes > 0 ? `:${minutes.toString().padStart(2, '0')}` : '';
  return `${displayHour}${displayMinutes} ${period}`;
}

/**
 * Calculate service duration based on service type and base hours
 */
export function calculateServiceDuration(baseHours: number, serviceType: string): number {
  if (serviceType === 'deep' || serviceType === 'moveInOut') {
    return baseHours + 2;
  }
  return baseHours;
}
