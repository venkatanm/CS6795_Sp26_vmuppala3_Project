/**
 * Security Utilities for PII Vault Pattern
 * 
 * Implements data separation and encryption to ensure psychometric data
 * (responses, scores) cannot be traced back to student names/emails without
 * a separate, secured key.
 * 
 * Key Principles:
 * 1. IndexedDB (logs, responses) stores only hashed user IDs (student_hash_id)
 * 2. PII (name, email) is encrypted before sending to server
 * 3. Encryption key is managed securely (via Clerk or HTTP-only cookie)
 */

/**
 * Hash a user ID to create a student_hash_id.
 * 
 * Uses SHA-256 to create a deterministic hash that cannot be reversed
 * to the original user ID without the mapping table.
 * 
 * @param userId - The original user ID (e.g., Clerk user ID)
 * @returns Promise<string> - The hashed user ID (student_hash_id)
 */
export async function hashUserId(userId: string): Promise<string> {
  // Use Web Crypto API for secure hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(userId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Synchronous hash function (for cases where async is not possible).
 * Uses a simpler hash algorithm - less secure but deterministic.
 * 
 * @param userId - The original user ID
 * @returns string - The hashed user ID
 */
export function hashUserIdSync(userId: string): string {
  // Simple hash function (FNV-1a variant)
  // Note: This is less secure than SHA-256 but useful for synchronous operations
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Get encryption key from secure storage.
 * 
 * Priority:
 * 1. HTTP-only cookie (if available via API)
 * 2. Clerk session token (if using Clerk)
 * 3. Generate and store in sessionStorage (less secure, fallback only)
 * 
 * @returns Promise<string> - The encryption key
 */
async function getEncryptionKey(): Promise<string> {
  // Try to get from HTTP-only cookie via API endpoint
  try {
    const response = await fetch('/api/security/encryption-key', {
      credentials: 'include', // Include cookies
    });
    if (response.ok) {
      const data = await response.json();
      if (data.key) {
        return data.key;
      }
    }
  } catch (error) {
    console.warn('[Security] Could not fetch encryption key from server:', error);
  }

  // Fallback: Use Clerk session token or generate a key
  // In production, this should be managed server-side
  if (typeof window !== 'undefined') {
    const storedKey = sessionStorage.getItem('pii_encryption_key');
    if (storedKey) {
      return storedKey;
    }

    // Generate a key (this is a fallback - in production, key should come from server)
    const generatedKey = generateEncryptionKey();
    sessionStorage.setItem('pii_encryption_key', generatedKey);
    return generatedKey;
  }

  throw new Error('Unable to get encryption key');
}

/**
 * Generate a random encryption key.
 * 
 * @returns string - A random 32-byte hex string
 */
function generateEncryptionKey(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Encrypt PII data using AES-GCM.
 * 
 * @param data - The PII data to encrypt (name, email, etc.)
 * @param key - The encryption key (optional, will be fetched if not provided)
 * @returns Promise<string> - The encrypted data as base64 string
 */
export async function encryptPII(
  data: string,
  key?: string
): Promise<string> {
  const encryptionKey = key || await getEncryptionKey();

  // Convert key to CryptoKey
  const keyBuffer = new Uint8Array(
    encryptionKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  // Generate IV (initialization vector)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the data
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    dataBuffer
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encryptedBuffer), iv.length);

  // Convert to base64 for storage
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt PII data (server-side only - not exposed to client).
 * 
 * This function is provided for reference but should only be used
 * on the server side with the encryption key.
 * 
 * @param encryptedData - The encrypted data as base64 string
 * @param key - The encryption key
 * @returns Promise<string> - The decrypted data
 */
export async function decryptPII(
  encryptedData: string,
  key: string
): Promise<string> {
  // Convert key to CryptoKey
  const keyBuffer = new Uint8Array(
    key.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  // Decode base64
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

  // Extract IV and encrypted data
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  // Decrypt
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encrypted
  );

  // Convert to string
  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Sanitize data to remove PII before storing in IndexedDB.
 * 
 * Removes email addresses, names, and other PII from data objects.
 * 
 * @param data - The data object to sanitize
 * @returns The sanitized data object
 */
export function sanitizeData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Remove email addresses
    return data.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REMOVED]');
  }

  if (Array.isArray(data)) {
    return data.map(item => sanitizeData(item));
  }

  if (typeof data === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip known PII fields
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('email') ||
        lowerKey.includes('name') ||
        lowerKey.includes('firstname') ||
        lowerKey.includes('lastname') ||
        lowerKey === 'user' ||
        lowerKey === 'username'
      ) {
        // Skip this field
        continue;
      }
      sanitized[key] = sanitizeData(value);
    }
    return sanitized;
  }

  return data;
}

/**
 * Check if a string contains PII (email address).
 * 
 * @param text - The text to check
 * @returns boolean - True if text contains an email address
 */
export function containsPII(text: string): boolean {
  if (typeof text !== 'string') {
    return false;
  }
  // Check for email pattern
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  return emailRegex.test(text);
}

/**
 * Prepare user data for secure storage.
 * 
 * Returns an object with:
 * - student_hash_id: Hashed user ID for IndexedDB storage
 * - encryptedPII: Encrypted name and email for server storage
 * 
 * @param userId - The user ID (e.g., Clerk user ID)
 * @param name - The user's name (optional)
 * @param email - The user's email (optional)
 * @returns Promise with sanitized data
 */
export async function prepareUserDataForStorage(
  userId: string,
  name?: string | null,
  email?: string | null
): Promise<{
  student_hash_id: string;
  encryptedPII?: {
    encryptedName?: string;
    encryptedEmail?: string;
  };
}> {
  // Hash the user ID
  const studentHashId = await hashUserId(userId);

  // Encrypt PII if provided
  const encryptedPII: {
    encryptedName?: string;
    encryptedEmail?: string;
  } = {};

  if (name) {
    encryptedPII.encryptedName = await encryptPII(name);
  }

  if (email) {
    encryptedPII.encryptedEmail = await encryptPII(email);
  }

  return {
    student_hash_id: studentHashId,
    encryptedPII: Object.keys(encryptedPII).length > 0 ? encryptedPII : undefined,
  };
}
