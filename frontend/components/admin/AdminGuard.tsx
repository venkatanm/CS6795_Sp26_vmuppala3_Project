'use client';

import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface AdminGuardProps {
  children: React.ReactNode;
}

/**
 * Client-side component to guard admin routes.
 * Checks if user has admin role in Clerk's public metadata.
 * Redirects to home if not admin.
 */
export default function AdminGuard({ children }: AdminGuardProps) {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!user) {
      // User not authenticated, redirect to home
      router.push('/');
      return;
    }

    // Check if user has admin role in public metadata
    const role = user.publicMetadata?.role as string | undefined;
    const userIsAdmin = role === "admin";
    
    setIsAdmin(userIsAdmin);

    if (!userIsAdmin) {
      // User is not admin, redirect to home
      router.push('/');
    }
  }, [user, isLoaded, router]);

  // Show loading state while checking
  if (!isLoaded || isAdmin === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // If not admin, don't render children (redirect will happen)
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg text-red-600 dark:text-red-400">
          Access Denied: Admin privileges required
        </div>
      </div>
    );
  }

  // User is admin, render children
  return <>{children}</>;
}
