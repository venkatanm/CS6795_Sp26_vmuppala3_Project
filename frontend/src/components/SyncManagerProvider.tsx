'use client';

import { useEffect } from 'react';
import { syncManager } from '@/src/services/SyncManager';

/**
 * SyncManagerProvider Component
 * 
 * Initializes the SyncManager to handle offline-to-online reconciliation.
 * This component should be included in the root layout.
 */
export default function SyncManagerProvider() {
  useEffect(() => {
    // Initialize the sync manager
    syncManager.initialize();

    // Cleanup on unmount
    return () => {
      syncManager.cleanup();
    };
  }, []);

  // This component doesn't render anything
  return null;
}
