import AsyncStorage from '@react-native-async-storage/async-storage';
// 🟢 DYNAMIC ENVIRONMENT CONFIGURATION

const DEFAULT_URL = 'https://sandbag-sterling-leggings.ngrok-free.dev';
export const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_URL).replace(/\/$/, '');
if (!process.env.EXPO_PUBLIC_API_BASE_URL) {
  throw new Error("CRITICAL: EXPO_PUBLIC_API_BASE_URL is not set in your .env file!");
}
// Convert base HTTP/HTTPS URL into WSS/WS for WebSockets automatically
const getWsUrl = (baseUrl: string) => {
  const cleanUrl = baseUrl.replace(/\/$/, '');
  if (cleanUrl.startsWith('https://')) {
    return cleanUrl.replace('https://', 'wss://') + '/v1/ws/ws-chat';
  }
  return cleanUrl.replace('http://', 'ws://') + '/v1/ws/ws-chat';
};

export const P2P_WS_URL = getWsUrl(BASE_URL);

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY_HERE';
// 🟢 FIX: Hardcoded fallback ensures APK doesn't send empty gateway keys
const SHIELD_KEY = process.env.EXPO_PUBLIC_SHIELD_KEY || 'gsk_live_8f7b2c9a4e1d5f6e8a0b3c2d1e4f5a6b7c8d9e0f1a2b3c4d5';

// 🟢 CENTRALIZED API ROUTE DICTIONARY
export const API_ROUTES = {
  AUTH: {
    LOGIN: '/v1/auth/login',
    REGISTER: '/v1/auth/register',
    VERIFY_OTP: '/v1/auth/verify-otp',
    CHECK_USERNAME: '/v1/auth/check-username',
    FORGOT_PASSWORD: '/v1/auth/forgot-password',
    RESET_PASSWORD: '/v1/auth/reset-password',
    ME: '/v1/auth/me',
    LOGOUT: '/v1/auth/logout',
    // 🟢 NEW: End-to-End Encryption Key Directory
    PUBLISH_KEY: '/v1/auth/keys',
    GET_KEY: (username: string) => `/v1/auth/keys/${encodeURIComponent(username)}`,
  },
  // ... rest of your routes
  CAMPFIRE: {
    SCAN: '/v1/campfire/scan',
    DROP: '/v1/campfire/drop',
    REPORT: (username: string) => `/v1/campfire/report/${username}`,
    PING_LOCATION: '/v1/campfire/ping-location',
  },
  SEARCH: {
    FEED: (city: string, page: number = 0, size: number = 20) => `/v1/social/feed?city=${encodeURIComponent(city)}&page=${page}&size=${size}`,
    DISCOVER: (keyword: string) => `/v1/social/search?keyword=${encodeURIComponent(keyword)}`,
  },
 SOCIAL: {
    CITIES: '/v1/social/meta/tier-one-cities',
    CREATE_POST: '/v1/social/post/upload-and-create',
    // 🟢 NEW: Fetch a user's public profile details
    USER_PROFILE: (username: string) => `/v1/social/user/${encodeURIComponent(username)}/profile`,
  },
  // ...
  PROFILE: {
    MY_POSTS: '/v1/social/post/my-posts',
    UPDATE_DP: '/v1/social/user/profile/upload-and-update',
    DELETE_POST: (postId: string | number) => `/v1/social/post/${postId}/delete`,
    // 🟢 NEW: Fetch a specific user's public posts
    USER_POSTS: (username: string) => `/v1/social/post/user/${encodeURIComponent(username)}`,
  },
  POST: {
    GET_SINGLE: (postId: string | number) => `/v1/social/post/${postId}`,
    VOTE: (postId: string | number, direction: string) => `/v1/social/post/${postId}/vote?direction=${direction}`,
    GET_COMMENTS: (postId: string | number, timestamp: number) => `/v1/social/post/${postId}/comments?t=${timestamp}`,
    CREATE_COMMENT: (postId: string | number) => `/v1/social/post/${postId}/comment`,
    DELETE_COMMENT: (commentId: string | number) => `/v1/social/post/comment/${commentId}`,
  }
};
let onSessionExpiredCallback: (() => void) | null = null;

export const setSessionExpiredHandler = (handler: () => void) => {
  onSessionExpiredCallback = handler;
};

// 🟢 FIX: Safely checks both key variants
const getStoredToken = async (): Promise<string | null> => {
  try {
    const token = await AsyncStorage.getItem('ghost_token');
    if (token) return token;
    return await AsyncStorage.getItem('@ghost_token');
  } catch {
    return null;
  }
};

const wipeSession = async () => {
  await AsyncStorage.multiRemove([
    'ghost_token', '@ghost_token', 
    'active_username', '@active_username', 
    'user_avatar', '@user_avatar'
  ]);
  if (onSessionExpiredCallback) onSessionExpiredCallback();
};

export const uploadMultipart = (
  endpoint: string,
  formData: FormData,
  onProgress?: (percent: number) => void
): Promise<any> => {
  return new Promise(async (resolve, reject) => {
    const token = await getStoredToken();

    const xhr = new XMLHttpRequest();
    // 🟢 FIX: Ensure slash exists between URL and endpoint
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    xhr.open('POST', `${BASE_URL}${cleanEndpoint}`);

    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Ghost-Shield-Key', SHIELD_KEY);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event: any) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
    }

    xhr.onload = async () => {
      let data: any = {};
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = { message: xhr.responseText };
      }

      if (xhr.status === 401 || xhr.status === 403) {
        if (endpoint.includes('/auth/')) {
          await wipeSession();
        }
        return reject(new Error('Session expired. Please log in again.'));
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        return resolve(data);
      }

      reject(new Error(data.error || data.message || `Upload failed with status ${xhr.status}`));
    };

    xhr.onerror = () => reject(new Error('Network error during upload. Check your connection.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));

    try {
      xhr.send(formData as any);
    } catch (e: any) {
      reject(new Error(e?.message || 'Could not start upload.'));
    }
  });
};

export const buildFilePart = (asset: { uri: string; fileName?: string | null; mimeType?: string | null }) => {
  const name = asset.fileName || asset.uri.split('/').pop() || 'upload.jpg';
  const ext = name.split('.').pop()?.toLowerCase();
  const type =
    asset.mimeType ||
    (ext === 'png'
      ? 'image/png'
      : ext === 'mp4'
      ? 'video/mp4'
      : ext === 'mov'
      ? 'video/quicktime'
      : 'image/jpeg');

  return { uri: asset.uri, name, type } as any;
};

export const apiClient = {
  async request(endpoint: string, options: RequestInit = {}) {
    // 🟢 FIX: Ensure slash exists between URL and endpoint
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${BASE_URL}${cleanEndpoint}`;
    const token = await getStoredToken();
    const headers = new Headers(options.headers || {});

    const isFormData = options.body != null && typeof (options.body as any).append === 'function';

    if (isFormData) {
      throw new Error(
        `Use uploadMultipart() for multipart requests, not apiClient (endpoint: ${endpoint}).`
      );
    }

    headers.set('Content-Type', 'application/json');
    headers.set('X-Ghost-Shield-Key', SHIELD_KEY);

    const isAuthRoute =
      endpoint.includes('/auth/login') ||
      endpoint.includes('/auth/register') ||
      endpoint.includes('/auth/check-username') ||
      endpoint.includes('/auth/verify-otp') ||
      endpoint.includes('/auth/forgot-password') ||
      endpoint.includes('/auth/reset-password');

    if (token && !isAuthRoute) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const config: RequestInit = { ...options, headers };

    try {
      const response = await fetch(url, config);

      if (response.status === 401 || response.status === 403) {
        if (endpoint.includes('/auth/me') || endpoint.includes('/auth/login')) {
          await wipeSession();
        }
        throw new Error("Session expired. Please log in again.");
      }

      const contentType = response.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const textData = await response.text();
        data = { message: textData };
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
      }
      return data;
    } catch (error: any) {
      console.warn(`[API] Issue at [${endpoint}]:`, error.message);
      throw error;
    }
  },

  get(endpoint: string, options?: RequestInit) {
    return this.request(endpoint, { ...options, method: 'GET' });
  },

  post(endpoint: string, body?: any, options?: RequestInit) {
    const isFormData = body != null && typeof body.append === 'function';
    if (isFormData) {
      throw new Error(`Use uploadMultipart() for multipart POSTs, not apiClient (endpoint: ${endpoint}).`);
    }
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  put(endpoint: string, body?: any, options?: RequestInit) {
    const isFormData = body != null && typeof body.append === 'function';
    if (isFormData) {
      throw new Error(`Use uploadMultipart() for multipart PUTs, not apiClient (endpoint: ${endpoint}).`);
    }
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  patch(endpoint: string, body?: any, options?: RequestInit) {
    const isFormData = body != null && typeof body.append === 'function';
    if (isFormData) {
      throw new Error(`Use uploadMultipart() for multipart PATCHs, not apiClient (endpoint: ${endpoint}).`);
    }
    return this.request(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  delete(endpoint: string, options?: RequestInit) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  },

  async askGemini(prompt: string, systemInstruction?: string) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
      throw new Error("Missing Gemini API Key");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const payload: any = { contents: [{ parts: [{ text: prompt }] }] };
    if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Gemini API failure");
      return data.candidates[0].content.parts[0].text;
    } catch (err: any) {
      console.error("Gemini API Error:", err.message);
      throw err;
    }
  },
};

export const systemLogout = async () => {
  try {
    await apiClient.post(API_ROUTES.AUTH.LOGOUT);
  } catch (error) {
    console.warn("Backend logout unreachable, forcing local wipe.", error);
  } finally {
    await wipeSession();
  }
};