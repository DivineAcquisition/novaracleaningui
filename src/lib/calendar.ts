import { format } from 'date-fns';

interface CalendarEvent {
  title: string;
  description: string;
  location: string;
  startDate: Date;
  endDate: Date;
}

export function generateICalFile(event: CalendarEvent): string {
  const formatDate = (date: Date) => {
    return format(date, "yyyyMMdd'T'HHmmss");
  };

  const escapeString = (str: string) => {
    return str.replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  };

  const ical = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Novara Cleaning//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${formatDate(event.startDate)}`,
    `DTEND:${formatDate(event.endDate)}`,
    `DTSTAMP:${formatDate(new Date())}`,
    `SUMMARY:${escapeString(event.title)}`,
    `DESCRIPTION:${escapeString(event.description)}`,
    `LOCATION:${escapeString(event.location)}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return ical;
}

export function downloadICalFile(event: CalendarEvent, filename: string = 'booking.ics') {
  const icalContent = generateICalFile(event);
  const blob = new Blob([icalContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(link.href);
}

export function addToGoogleCalendar(event: CalendarEvent): string {
  const formatGoogleDate = (date: Date) => {
    return format(date, "yyyyMMdd'T'HHmmss");
  };

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    details: event.description,
    location: event.location,
    dates: `${formatGoogleDate(event.startDate)}/${formatGoogleDate(event.endDate)}`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function addToOutlookCalendar(event: CalendarEvent): string {
  const formatOutlookDate = (date: Date) => {
    return format(date, "yyyy-MM-dd'T'HH:mm:ss");
  };

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    body: event.description,
    location: event.location,
    startdt: formatOutlookDate(event.startDate),
    enddt: formatOutlookDate(event.endDate),
  });

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
