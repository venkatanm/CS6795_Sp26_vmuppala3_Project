'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * QueryProvider Component
 * 
 * Wraps the app with React Query's QueryClientProvider.
 * Must be a Client Component because QueryClient is a class instance.
 */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  // Create QueryClient in useState to ensure it's only created once per component instance
  // This prevents creating a new client on every render
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0, // Always refetch (modules can change)
        gcTime: 0, // Don't cache (we want fresh data) - gcTime replaces cacheTime in v5
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
