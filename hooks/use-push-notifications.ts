// Stub for push notifications - web version doesn't use native push
export function usePushNotifications() {
  return {
    requestPermission: async () => false,
    getToken: async () => null,
    isSupported: false,
  };
}
