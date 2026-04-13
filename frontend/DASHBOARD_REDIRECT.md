# Dashboard Redirect Setup

## Issue Fixed

Students were not being redirected to the dashboard after signing in. They were staying on the home page (`/`).

## Changes Made

### 1. **Automatic Redirect** (in `frontend/app/page.tsx`)
- Added logic to automatically redirect students to `/dashboard` when they sign in
- Only applies to non-admin users
- Admins stay on home page (they have their own admin dashboard)

### 2. **Dashboard Button** (in `frontend/app/page.tsx`)
- Added "Student Dashboard" button in the top navigation bar
- Only visible to logged-in students (not admins)
- Allows easy navigation to the dashboard

### 3. **Environment Variable** (Update `.env.local`)
Update your `frontend/.env.local` file to redirect to dashboard after sign-in:

```env
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
```

**Important:** After updating `.env.local`, restart your Next.js dev server for changes to take effect.

## How It Works Now

1. **Student Signs In:**
   - Clerk redirects to `/dashboard` (via `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`)
   - OR if they land on `/`, the page automatically redirects them to `/dashboard`

2. **Admin Signs In:**
   - Stays on home page (can access admin dashboard via button)
   - Can also access student dashboard if needed

3. **Navigation:**
   - Students see "Student Dashboard" button in top right
   - Admins see "Admin Dashboard" button in top right
   - Both see UserButton for profile/sign-out

## Testing

1. **Sign in as a student:**
   - Should automatically redirect to `/dashboard`
   - Should see "The Lobby" (available exams) and "The Cockpit" (history)

2. **Sign in as an admin:**
   - Should stay on home page
   - Should see "Admin Dashboard" button
   - Can click "Take Exam" to access student features

3. **Manual navigation:**
   - Students can click "Student Dashboard" button anytime
   - Or navigate directly to `/dashboard`
