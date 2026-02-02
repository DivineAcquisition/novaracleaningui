import imageCompression from 'browser-image-compression';

export interface ImageValidationResult {
  isValid: boolean;
  error?: string;
}

export const validateImage = async (file: File): Promise<ImageValidationResult> => {
  // Check file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: 'Please upload a JPEG, PNG, or WebP image.'
    };
  }

  // Check dimensions
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      if (img.width < 256 || img.height < 256) {
        resolve({
          isValid: false,
          error: 'Image must be at least 256x256 pixels.'
        });
      } else {
        resolve({ isValid: true });
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      resolve({
        isValid: false,
        error: 'Failed to load image.'
      });
    };
    img.src = URL.createObjectURL(file);
  });
};

export const compressImage = async (file: File): Promise<File> => {
  const options = {
    maxSizeMB: 2,
    maxWidthOrHeight: 512,
    useWebWorker: true,
    fileType: file.type,
    initialQuality: 0.8,
  };

  try {
    const compressedFile = await imageCompression(file, options);
    return compressedFile;
  } catch (error) {
    console.error('Error compressing image:', error);
    throw new Error('Failed to compress image. Please try a different image.');
  }
};

export const processAvatarImage = async (file: File): Promise<{ file: File; preview: string }> => {
  // Validate
  const validation = await validateImage(file);
  if (!validation.isValid) {
    throw new Error(validation.error);
  }

  // Compress
  const compressedFile = await compressImage(file);
  
  // Create preview
  const preview = URL.createObjectURL(compressedFile);

  return { file: compressedFile, preview };
};
