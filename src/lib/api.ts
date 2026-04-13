import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

/**
 * Axios instance configured for the FastAPI backend.
 * Automatically injects X-Tenant-ID header into every request.
 */
const api: AxiosInstance = axios.create({
  baseURL: 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to automatically inject X-Tenant-ID header
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Inject X-Tenant-ID header if not already present
    if (!config.headers['X-Tenant-ID']) {
      config.headers['X-Tenant-ID'] = 'school_A';
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;
