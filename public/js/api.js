/**
 * API Interceptor (Axios)
 * จัดการการส่ง Token และดักจับ Error 401
 */

// สร้าง instance ของ axios
const api = axios.create({
  baseURL: '/',
  headers: {
    'Content-Type': 'application/json'
  }
});

// 1. Request Interceptor: แนบ Token เข้าไปใน Header อัตโนมัติ
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token'); // หรือดึงจากที่อื่น
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 2. Response Interceptor: จัดการ Error 401
api.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    if (error.response && error.response.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Logic สำหรับ Logout หรือ Refresh Token
      console.warn('Unauthorized! Logging out...');
      
      // ล้าง Token และกลับไปหน้า Login
      localStorage.removeItem('auth_token');
      window.location.href = '/'; 
      
      /* 
      // ตัวอย่างการใช้ Refresh Token (ถ้ามี)
      try {
        const res = await axios.post('/auth/refresh-token');
        const { newToken } = res.data;
        localStorage.setItem('auth_token', newToken);
        api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        window.location.href = '/';
      }
      */
    }
    return Promise.reject(error);
  }
);

window.api = api; // เผื่อเรียกใช้ทั่วโลก
