import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { toast } from '@/hooks/use-toast';

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export function useNativeGeolocation() {
  const isNative = Capacitor.isNativePlatform();

  const getCurrentPosition = async (): Promise<Coordinates | null> => {
    try {
      if (!isNative) {
        console.log('Geolocation not available in web mode');
        return null;
      }

      const position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
    } catch (error) {
      console.error('Error getting location:', error);
      toast({
        title: "Location error",
        description: "Failed to get your location. Please enable location services.",
        variant: "destructive",
      });
      return null;
    }
  };

  const checkPermissions = async () => {
    try {
      const permission = await Geolocation.checkPermissions();
      return permission.location;
    } catch (error) {
      console.error('Error checking permissions:', error);
      return 'denied';
    }
  };

  const requestPermissions = async () => {
    try {
      const permission = await Geolocation.requestPermissions();
      return permission.location;
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return 'denied';
    }
  };

  return { getCurrentPosition, checkPermissions, requestPermissions, isNative };
}
