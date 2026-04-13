# Clerk Authentication Setup

## Environment Variables

Add the following environment variables to your `.env.local` file in the `frontend` directory:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
```

## Getting Your Clerk Keys

1. Go to [https://clerk.com](https://clerk.com) and sign up/login
2. Create a new application
3. Go to **API Keys** in your Clerk dashboard
4. Copy the **Publishable Key** and **Secret Key**
5. Add them to your `.env.local` file

## Protected Routes

The following routes require authentication:
- `/admin/*` - Admin dashboard and all admin pages
- `/dashboard/*` - Dashboard routes (if any)
- `/exam/*` - Exam pages and exam sessions

## Public Routes

The following routes are public (no authentication required):
- `/` - Landing page (home page)

## Next Steps

1. Create sign-in and sign-up pages (optional, Clerk provides default UI)
2. Add user authentication checks in your components using `useUser()` from `@clerk/nextjs`
3. Customize the authentication UI if needed

## Setting Up Admin Users

### Method 1: Using Clerk Dashboard (Recommended)

1. Go to your [Clerk Dashboard](https://dashboard.clerk.com)
2. Navigate to **Users** in the sidebar
3. Find the user you want to make an admin
4. Click on the user to open their details
5. Scroll to **Public Metadata** section
6. Add the following JSON:
   ```json
   {
     "role": "admin"
   }
   ```
7. Click **Save**

### Method 2: Using Clerk API (Programmatic)

You can also set admin role programmatically using Clerk's Management API:

```typescript
import { clerkClient } from "@clerk/nextjs/server";

// Set user as admin
await clerkClient.users.updateUserMetadata(userId, {
  publicMetadata: {
    role: "admin"
  }
});
```

### Method 3: Using Email Domain (Alternative)

If you want to automatically grant admin access based on email domain, you can modify the `AdminGuard` component to check email addresses:

```typescript
const isAdmin = user.emailAddresses.some(
  email => email.emailAddress.endsWith('@yourdomain.com')
);
```

## How It Works

- Admin routes (`/admin/*`) are protected by the `AdminGuard` component
- The guard checks if the user has `role: "admin"` in their Clerk public metadata
- Non-admin users are redirected to the home page
- Students can still access `/exam/*` routes (they just need to be authenticated)
