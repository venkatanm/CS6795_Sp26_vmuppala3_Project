'use client';

/**
 * Exam Layout
 *
 * Overrides the root ClerkProvider configuration for exam routes so that
 * Clerk does NOT redirect to sign-in when it temporarily loses connectivity
 * (offline resilience — TC-20).
 *
 * The exam pages use IndexedDB / local state and must remain usable even
 * when the network (and therefore Clerk's token refresh) is unavailable.
 * Removing `signInFallbackRedirectUrl` here means Clerk will not force a
 * navigation to /sign-in if it can't refresh the session token while on an
 * exam page.
 */

import { ClerkProvider } from '@clerk/nextjs';

export default function ExamLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      {children}
    </ClerkProvider>
  );
}
