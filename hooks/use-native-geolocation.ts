// Stub for native geolocation - uses browser API instead
export function useNativeGeolocation() {
  const getCurrentPosition = async () => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return new Promise<{ lat: number; lng: number }>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            });
          },
          reject
        );
      });
    }
    throw new Error('Geolocation not available');
  };

  return {
    getCurrentPosition,
    isAvailable: typeof navigator !== 'undefined' && !!navigator.geolocation,
  };
}
