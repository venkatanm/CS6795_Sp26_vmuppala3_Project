'use client';

import { useEffect, useState, useRef } from 'react';
interface TimerProps {
  expiresAt: string | null;
  onExpire: () => void;
  position?: 'fixed-top-right' | 'inline';
}

const defaultConfig = {
  timer: {
    direction: 'down' as 'down' | 'up',
    autoSubmitAtZero: true,
  },
};

export default function Timer({ expiresAt, onExpire, position = 'inline' }: TimerProps) {
  const config = defaultConfig;
  const [time, setTime] = useState<number>(0);
  const [display, setDisplay] = useState<string>('00:00');
  const [isExpired, setIsExpired] = useState(false);
  const onExpireCalledRef = useRef(false);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // If timer direction is 'up', we need a start time
    if (config.timer.direction === 'up') {
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }
    }

    // If expiresAt is null, don't render timer
    if (!expiresAt && config.timer.direction === 'down') {
      setTime(0);
      setDisplay('Unlimited Time');
      return;
    }

    // Calculate time based on direction
    const calculateTime = () => {
      if (config.timer.direction === 'up') {
        // Count up from start time
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
          return 0;
        }
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        return elapsed;
      } else {
        // Count down from expiresAt
        try {
          const now = new Date();
          const expiryStr = expiresAt!.replace('Z', '+00:00');
          const expiry = new Date(expiryStr);
          
          if (isNaN(expiry.getTime())) {
            return 0;
          }
          
          const diff = expiry.getTime() - now.getTime();
          return Math.max(0, Math.floor(diff / 1000));
        } catch (error) {
          return 0;
        }
      }
    };

    // Initial calculation
    const initialTime = calculateTime();
    setTime(initialTime);

    // Update display immediately
    const updateDisplay = (seconds: number) => {
      if (config.timer.direction === 'down' && seconds <= 0) {
        setDisplay('00:00');
        setIsExpired(true);
        // Check if auto-submit is enabled
        if (!onExpireCalledRef.current) {
          onExpireCalledRef.current = true;
          if (config.timer.autoSubmitAtZero) {
            // Auto-submit when timer hits zero
            onExpire();
          } else {
            // Just turn red but don't force submit
            console.log('[Timer] Time limit reached - timer red (auto-submit disabled)');
          }
        }
      } else {
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        setDisplay(`${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
        setIsExpired(false);
      }
    };

    updateDisplay(initialTime);

    // Set up interval to update every second
    const interval = setInterval(() => {
      const newTime = calculateTime();
      setTime(newTime);
      updateDisplay(newTime);
    }, 1000);

    // Cleanup interval on unmount or when expiresAt changes
    return () => {
      clearInterval(interval);
      onExpireCalledRef.current = false; // Reset flag when expiresAt changes
    };
  }, [expiresAt, onExpire, config.timer.autoSubmitAtZero, config.timer.direction]);

  // If expiresAt is null, render nothing or 'Unlimited Time'
  if (!expiresAt) {
    if (position === 'fixed-top-right') {
      return null; // Don't render anything in fixed position if no expiration
    }
    return (
      <div className="text-sm text-zinc-500 dark:text-zinc-400">
        Unlimited Time
      </div>
    );
  }

  // Determine styling based on time
  // For countdown: red when expired or < 60 seconds
  // For countup: always normal color
  const isUrgent = config.timer.direction === 'down' && (isExpired || (time !== null && time < 60));
  const textColor = isUrgent 
    ? 'text-red-600 dark:text-red-400 font-bold' 
    : 'text-zinc-900 dark:text-zinc-50';
  
  // Base classes
  const baseClasses = `text-lg font-mono ${textColor} transition-colors`;
  
  // Position-specific classes
  const positionClasses = position === 'fixed-top-right'
    ? 'fixed top-4 right-4 z-50 bg-white dark:bg-zinc-900 px-4 py-2 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800'
    : '';
  
  return (
    <div className={`${baseClasses} ${positionClasses}`}>
      {display}
    </div>
  );
}
