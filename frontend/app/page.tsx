'use client';

import { useUser, SignInButton, SignUpButton } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import DashboardPage from './dashboard/page'; // Import the DashboardPage component

export default function Home() {
  const { user, isLoaded } = useUser();

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // If user is logged in, show the dashboard content directly
  if (user) {
    return <DashboardPage />;
  }

  // If user is not logged in, show the landing page content
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      {/* Top Navigation Bar */}
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <SignInButton mode="modal">
          <Button variant="outline" size="sm" className="border-zinc-300 dark:border-zinc-700">
            Sign In
          </Button>
        </SignInButton>
        <SignUpButton mode="modal">
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white">
            Sign Up
          </Button>
        </SignUpButton>
      </div>

      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-center py-32 px-16 bg-white dark:bg-black sm:items-start">
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left w-full">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            Welcome to Velox
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Your personalized SAT math exam platform. Sign in to access your dashboard and start practicing.
          </p>
          
          <div className="flex gap-4 mt-4">
            <SignInButton mode="modal">
              <Button size="lg" className="bg-indigo-600 hover:bg-indigo-700 text-white">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button size="lg" variant="outline" className="border-zinc-300 dark:border-zinc-700">
                Sign Up
              </Button>
            </SignUpButton>
          </div>
        </div>
      </main>
    </div>
  );
}
