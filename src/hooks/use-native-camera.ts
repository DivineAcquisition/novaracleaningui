import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import imageCompression from 'browser-image-compression';

export function useNativeCamera() {
  const isNative = Capacitor.isNativePlatform();

  const takePhoto = async () => {
    try {
      if (!isNative) {
        toast({
          title: "Camera not available",
          description: "Camera features are only available in the mobile app",
          variant: "destructive",
        });
        return null;
      }

      const image = await Camera.getPhoto({
        quality: 80,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
      });

      return image.webPath;
    } catch (error) {
      console.error('Error taking photo:', error);
      toast({
        title: "Camera error",
        description: "Failed to take photo. Please try again.",
        variant: "destructive",
      });
      return null;
    }
  };

  const uploadPhoto = async (photoUri: string, bookingId: string, type: 'before' | 'after') => {
    try {
      const response = await fetch(photoUri);
      const blob = await response.blob();

      const options = {
        maxSizeMB: 1,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      };

      const compressedFile = await imageCompression(blob as File, options);
      const fileName = `${bookingId}/${type}/${Date.now()}.jpg`;

      const { data, error } = await supabase.storage
        .from('job-photos')
        .upload(fileName, compressedFile, {
          contentType: 'image/jpeg',
          upsert: false,
        });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from('job-photos')
        .getPublicUrl(data.path);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading photo:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload photo. Please try again.",
        variant: "destructive",
      });
      return null;
    }
  };

  return { takePhoto, uploadPhoto, isNative };
}
