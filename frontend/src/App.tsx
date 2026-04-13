'use client';

import { useState } from 'react';
import { runDbHealthCheck } from '@/src/debug/db-health-check';
import { db } from '@/src/lib/db';

/**
 * DB Health Check Button Component
 * 
 * Temporary button for testing database connection.
 * Positioned fixed at top left of the screen.
 */
export default function DBHealthCheckButton() {
  const [isLoading, setIsLoading] = useState(false);

  const handleTestDB = async () => {
    setIsLoading(true);
    try {
      const msg = await runDbHealthCheck();
      alert(msg);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      alert('❌ DB FAILURE: ' + errorMessage);
    } finally {
      setIsLoading(false);
    }
  };


  return (
    <>
      <button
        onClick={handleTestDB}
        disabled={isLoading}
        className="fixed top-4 left-4 z-50 px-5 py-3 bg-blue-600 text-white border-none rounded-lg cursor-pointer text-sm font-medium shadow-md opacity-50 hover:opacity-100 transition-opacity disabled:opacity-70 disabled:cursor-wait"
        title="Test IndexedDB connection"
      >
        {isLoading ? '⏳ Testing...' : '🏥 Test DB'}
      </button>
      
    </>
  );
}
