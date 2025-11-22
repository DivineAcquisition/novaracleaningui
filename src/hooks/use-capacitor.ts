import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export function useCapacitor() {
  const [isNative, setIsNative] = useState(false);
  const [platform, setPlatform] = useState<'ios' | 'android' | 'web'>('web');

  useEffect(() => {
    setIsNative(Capacitor.isNativePlatform());
    setPlatform(Capacitor.getPlatform() as 'ios' | 'android' | 'web');
  }, []);

  return { isNative, platform };
}
