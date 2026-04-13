import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// 1. Define your public routes
const isPublicRoute = createRouteMatcher([
  '/',
  '/api/student/sync(.*)', // Keep this open while we verify the data flow
  '/api/tutor/socratic-hint(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/exam/(.*)',            // Exam pages work offline via IndexedDB — don't redirect when Clerk is unavailable
]);

export default clerkMiddleware(async (auth, request) => {
  // 2. Use the 'auth' parameter directly
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // 3. Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
