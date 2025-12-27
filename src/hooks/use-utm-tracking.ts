import { useEffect, useCallback } from 'react';

interface UTMData {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  landingPage?: string;
  referrer?: string;
  timestamp?: string;
}

const UTM_STORAGE_KEY = 'utm_tracking_data';

export function useUTMTracking() {
  // Capture UTM parameters on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    
    // Only capture if we have UTM params in URL
    const hasUTMParams = 
      urlParams.has('utm_source') ||
      urlParams.has('utm_medium') ||
      urlParams.has('utm_campaign') ||
      urlParams.has('utm_content') ||
      urlParams.has('utm_term');

    if (hasUTMParams) {
      const utmData: UTMData = {
        utmSource: urlParams.get('utm_source') || undefined,
        utmMedium: urlParams.get('utm_medium') || undefined,
        utmCampaign: urlParams.get('utm_campaign') || undefined,
        utmContent: urlParams.get('utm_content') || undefined,
        utmTerm: urlParams.get('utm_term') || undefined,
        landingPage: window.location.pathname,
        referrer: document.referrer || undefined,
        timestamp: new Date().toISOString(),
      };

      localStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utmData));
      console.log('[useUTMTracking] Captured UTM data:', utmData);
    }
  }, []);

  // Get stored UTM data
  const getUTMData = useCallback((): UTMData => {
    try {
      const stored = localStorage.getItem(UTM_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('[useUTMTracking] Error reading UTM data:', error);
    }

    // Return current page info even if no UTM params were captured
    return {
      landingPage: window.location.pathname,
      referrer: document.referrer || undefined,
      timestamp: new Date().toISOString(),
    };
  }, []);

  // Clear UTM data (e.g., after successful conversion)
  const clearUTMData = useCallback(() => {
    localStorage.removeItem(UTM_STORAGE_KEY);
    console.log('[useUTMTracking] Cleared UTM data');
  }, []);

  return {
    getUTMData,
    clearUTMData,
  };
}
