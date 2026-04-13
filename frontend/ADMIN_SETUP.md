# Admin User Setup Guide

## Quick Setup: Making a User an Admin

### Step 1: Sign Up/Login to Your App
1. Start your Next.js app: `npm run dev`
2. Navigate to your app (e.g., `http://localhost:3000`)
3. Sign up or sign in with the account you want to make an admin

### Step 2: Set Admin Role in Clerk Dashboard

1. **Go to Clerk Dashboard**
   - Visit [https://dashboard.clerk.com](https://dashboard.clerk.com)
   - Sign in with your Clerk account

2. **Navigate to Users**
   - Click on **Users** in the left sidebar
   - Find the user you want to make an admin (search by email if needed)
   - Click on the user to open their profile

3. **Add Admin Role to Public Metadata**
   - Scroll down to the **Public Metadata** section
   - Click **Edit** or the **+** button to add metadata
   - Add the following JSON:
     ```json
     {
       "role": "admin"
     }
     ```
   - Click **Save**

4. **Verify**
   - The user should now be able to access `/admin` routes
   - Try navigating to `http://localhost:3000/admin` - it should work!

## How It Works

- **AdminGuard Component**: Wraps all admin pages and checks if the user has `role: "admin"` in their Clerk public metadata
- **Protected Routes**: `/admin/*` routes require both authentication AND admin role
- **Student Routes**: `/exam/*` routes only require authentication (any logged-in user can access)
- **Admin as Student**: Admins can also take exams! They have full access to both admin and student features:
  - Admins can access `/admin/*` pages (admin dashboard, question studio)
  - Admins can also access `/` (home page) and `/exam/*` routes to take exams
  - A "Take Exam" button is available in the admin dashboard
  - An "Admin Dashboard" button is available on the home page for admins

## Testing Admin Access

1. **As Admin User**:
   - Navigate to `/admin` - Should see the admin dashboard
   - Navigate to `/admin/exams/create` - Should see the question studio

2. **As Regular User**:
   - Navigate to `/admin` - Should be redirected to home page
   - Navigate to `/exam/*` - Should work (students can take exams)

## Alternative: Programmatic Admin Assignment

If you want to set admin role programmatically (e.g., via an API endpoint), you can use Clerk's Management API:

```typescript
import { clerkClient } from "@clerk/nextjs/server";

// In an API route or server action
export async function setUserAsAdmin(userId: string) {
  await clerkClient.users.updateUserMetadata(userId, {
    publicMetadata: {
      role: "admin"
    }
  });
}
```

## Troubleshooting

### User can't access admin pages
- ✅ Check that user is signed in
- ✅ Check that `role: "admin"` is set in Clerk public metadata
- ✅ Check browser console for errors
- ✅ Try signing out and back in (to refresh user data)

### "Access Denied" message
- This means the user is authenticated but doesn't have admin role
- Go to Clerk dashboard and add the admin role as described above

### User metadata not updating
- Clerk caches user data - try signing out and back in
- Clear browser cache if needed
- Wait a few seconds after updating metadata in Clerk dashboard
