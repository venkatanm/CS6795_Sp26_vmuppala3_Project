import { auth, currentUser } from "@clerk/nextjs/server";

/**
 * Check if the current user is an admin.
 * Admin status is stored in Clerk's public metadata as `role: "admin"`
 * 
 * @returns Promise<boolean> - True if user is admin, false otherwise
 */
export async function isAdmin(): Promise<boolean> {
  try {
    const user = await currentUser();
    
    if (!user) {
      return false;
    }

    // Check public metadata for admin role
    const role = user.publicMetadata?.role as string | undefined;
    return role === "admin";
  } catch (error) {
    console.error("Error checking admin status:", error);
    return false;
  }
}

/**
 * Get the current user's ID from Clerk
 * @returns Promise<string | null> - User ID or null if not authenticated
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const { userId } = await auth();
    return userId;
  } catch (error) {
    console.error("Error getting user ID:", error);
    return null;
  }
}
