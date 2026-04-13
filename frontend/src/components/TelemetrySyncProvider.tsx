'use client';

import { useEffect } from 'react';
import { telemetrySyncService } from '@/src/services/TelemetrySync';

/**
 * TelemetrySyncProvider Component
 * 
 * Starts the telemetry sync service when the app loads.
 * This component should be included in the root layout.
 */
export default function TelemetrySyncProvider() {
  useEffect(() => {
    // Start the telemetry sync service
    telemetrySyncService.start();

    // Cleanup on unmount
    return () => {
      telemetrySyncService.stop();
    };
  }, []);

  // This component doesn't render anything
  return null;
}
