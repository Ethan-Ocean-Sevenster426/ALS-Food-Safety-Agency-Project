import axios from 'axios';

// Add JWT token to every request
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Handle 401 responses (expired/invalid token)
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      const currentPath = window.location.pathname;
      // Don't redirect if already on login/public pages
      if (!['/login', '/signup'].includes(currentPath) &&
          !currentPath.startsWith('/reset-password') &&
          !currentPath.startsWith('/accept-invite') &&
          !currentPath.startsWith('/epv/')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default axios;
