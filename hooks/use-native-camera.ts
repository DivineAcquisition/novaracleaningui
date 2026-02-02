// Stub for native camera - web version uses file input instead
export function useNativeCamera() {
  return {
    takePhoto: async () => {
      throw new Error('Native camera not available on web');
    },
    pickImage: async () => {
      throw new Error('Use file input for web');
    },
    isAvailable: false,
  };
}
