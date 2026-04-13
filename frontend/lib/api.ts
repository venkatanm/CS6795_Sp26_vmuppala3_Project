import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

let currentUserId: string | null = null;
let currentTenantId: string | null = null;

export function setApiUser(userId: string | null, tenantId: string | null = null) {
  currentUserId = userId;
  currentTenantId = tenantId || 'public';
}

api.interceptors.request.use(
  async (config) => {
    if (currentUserId && !config.headers['X-User-ID']) {
      config.headers['X-User-ID'] = currentUserId;
    }
    
    if (!config.headers['X-Tenant-ID']) {
      config.headers['X-Tenant-ID'] = currentTenantId || 'public';
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      console.error('Unauthorized - please log in');
    }
    return Promise.reject(error);
  }
);

export default api;
