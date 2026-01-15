"use client";

import { useSwipeable } from 'react-swipeable';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface UseBookingSwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  canSwipeLeft?: boolean;
  canSwipeRight?: boolean;
  step?: number;
}

const STEP_ROUTES = [
  '/book/zip',
  '/book/sqft',
  '/book/offer',
  '/book/checkout',
  '/book/details',
  '/book/confirmation',
];

export function useBookingSwipe({
  onSwipeLeft,
  onSwipeRight,
  canSwipeLeft = true,
  canSwipeRight = true,
  step,
}: UseBookingSwipeOptions = {}) {
  const router = useRouter();

  const handlers = useSwipeable({
    onSwipedLeft: () => {
      if (onSwipeLeft && canSwipeLeft) {
        onSwipeLeft();
      } else if (!onSwipeLeft && step && step < STEP_ROUTES.length && canSwipeLeft) {
        // Auto-navigate to next step if no custom handler
        router.push(STEP_ROUTES[step]);
        toast.info('Swipe right to go back');
      }
    },
    onSwipedRight: () => {
      if (onSwipeRight && canSwipeRight) {
        onSwipeRight();
      } else if (!onSwipeRight && step && step > 1 && canSwipeRight) {
        // Auto-navigate to previous step if no custom handler
        router.push(STEP_ROUTES[step - 2]);
      }
    },
    trackMouse: false, // Only track touch gestures on mobile
    trackTouch: true,
    delta: 50, // Minimum distance to trigger swipe (in pixels)
    preventScrollOnSwipe: false,
    rotationAngle: 0,
  });

  return handlers;
}
