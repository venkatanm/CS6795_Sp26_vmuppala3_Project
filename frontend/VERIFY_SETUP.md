# User Creation Setup Verification

## ✅ What's Already Set Up

1. **ClerkProvider** - Configured in `app/layout.tsx`
2. **Middleware** - Protects `/admin/*` and `/exam/*` routes
3. **Sign-In Page** - Created at `/sign-in`
4. **Sign-Up Page** - Created at `/sign-up`
5. **Home Page** - Has Sign In/Sign Up buttons and UserButton

## 🔍 Verify Your `.env.local` File

Make sure your `frontend/.env.local` file contains:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
```

### How to Get Your Clerk Keys:

1. Go to [https://dashboard.clerk.com](https://dashboard.clerk.com)
2. Select your application (or create one)
3. Go to **API Keys** in the sidebar
4. Copy:
   - **Publishable Key** → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - **Secret Key** → `CLERK_SECRET_KEY`

## 🧪 Test Your Setup

1. **Start your dev server:**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Test Sign Up:**
   - Go to `http://localhost:3000`
   - Click "Sign Up" button (top right)
   - Create a new account
   - You should be redirected to the home page

3. **Test Sign In:**
   - Sign out (click UserButton → Sign Out)
   - Click "Sign In" button
   - Sign in with your account
   - You should see the UserButton in the top right

4. **Test Protected Routes:**
   - Try to access `/exam/*` - Should require sign in
   - Try to access `/admin` - Should require sign in AND admin role

## 🚨 Common Issues

### "Clerk: Missing publishableKey"
- **Fix:** Make sure `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is in `.env.local`
- **Note:** The `NEXT_PUBLIC_` prefix is required for client-side access

### "Clerk: Missing secretKey"
- **Fix:** Make sure `CLERK_SECRET_KEY` is in `.env.local`
- **Note:** This should NOT have `NEXT_PUBLIC_` prefix (server-side only)

### Sign-in/Sign-up pages not working
- **Fix:** Restart your dev server after adding `.env.local`
- **Fix:** Make sure the file is named exactly `.env.local` (not `.env`)

### Users can't sign up
- **Fix:** Check Clerk Dashboard → **User & Authentication** → Make sure sign-up is enabled
- **Fix:** Check if email verification is required (may need to verify email first)

## ✅ Setup Checklist

- [ ] `.env.local` file exists in `frontend/` directory
- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is set
- [ ] `CLERK_SECRET_KEY` is set
- [ ] Sign-in and sign-up URLs are configured
- [ ] Dev server restarted after adding `.env.local`
- [ ] Can access sign-in page at `/sign-in`
- [ ] Can access sign-up page at `/sign-up`
- [ ] Can create a new user account
- [ ] Can sign in with existing account
- [ ] UserButton appears when signed in

## 🎯 Next Steps

Once user creation is working:

1. **Make a user an admin:**
   - Go to Clerk Dashboard → Users
   - Find the user → Public Metadata
   - Add: `{ "role": "admin" }`
   - Save

2. **Test admin access:**
   - Sign in as admin user
   - Navigate to `/admin` - Should work!
   - See "Admin Dashboard" button on home page
