import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const DEFAULT_URL = 'https://api.warnpack.com';
export const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_URL).replace(/\/$/, '');

const getWsUrl = (baseUrl: string) => {
  const cleanUrl = baseUrl.replace(/\/$/, '');
  if (cleanUrl.startsWith('https://')) return cleanUrl.replace('https://', 'wss://') + '/v1/ws/ws-chat';
  return cleanUrl.replace('http://', 'ws://') + '/v1/ws/ws-chat';
};

export const P2P_WS_URL = getWsUrl(BASE_URL);

// NOTE: anything in EXPO_PUBLIC_* is compiled into the APK and is NOT secret. Real protection is the JWT + gateway.
const SHIELD_KEY = process.env.EXPO_PUBLIC_SHIELD_KEY || '';

const REQUEST_TIMEOUT_MS = 30000;

const safeParam = (param: string | number | undefined | null) => encodeURIComponent(String(param || '').trim() || 'unknown');

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
    PUBLISH_KEY: '/v1/auth/keys',
    GET_KEY: (username: string) => `/v1/auth/keys/${safeParam(username)}`,
  },
  CAMPFIRE: {
    SCAN: '/v1/campfire/scan',
    DROP: '/v1/campfire/drop',
    PING_LOCATION: '/v1/campfire/ping-location',
    REPORT: (username: string) => `/v1/campfire/report/${safeParam(username)}`,
  },
  SEARCH: {
    FEED: (city: string, page: number = 0, size: number = 20) => `/v1/social/feed?city=${safeParam(city)}&page=${page}&size=${size}`,
    DISCOVER: (keyword: string) => `/v1/social/search?keyword=${safeParam(keyword)}`,
  },
  SOCIAL: {
    CITIES: '/v1/social/meta/tier-one-cities',
    FEED: (city: string, page: number = 0, size: number = 20) => `/v1/social/feed?city=${safeParam(city)}&page=${page}&size=${size}`,
    DISCOVER: (keyword: string) => `/v1/social/search?keyword=${safeParam(keyword)}`,
    CREATE_POST: '/v1/social/post/upload-and-create',
    USER_PROFILE: (username: string) => `/v1/social/user/${safeParam(username)}/full-profile`,
    DELETE_ACCOUNT: '/v1/social/user/me',
  },
  USERS: {
    PROFILE: (username: string) => `/v1/social/user/${safeParam(username)}/full-profile`,
    UPDATE_DP: '/v1/social/user/profile/upload-and-update',
  },
  PROFILE: {
    MY_POSTS: '/v1/social/post/my-posts',
    UPDATE_DP: '/v1/social/user/profile/upload-and-update',
    DELETE_POST: (postId: string | number) => `/v1/social/post/${postId}/delete`,
    USER_POSTS: (username: string) => `/v1/social/post/user/${safeParam(username)}`,
  },
  POST: {
    GET_SINGLE: (postId: string | number) => `/v1/social/post/${safeParam(postId)}`,
    VOTE: (postId: string | number, direction: string) => `/v1/social/post/${safeParam(postId)}/vote?direction=${direction}`,
    GET_COMMENTS: (postId: string | number, timestamp: number) => `/v1/social/post/${safeParam(postId)}/comments?t=${timestamp}`,
    CREATE_COMMENT: (postId: string | number) => `/v1/social/post/${safeParam(postId)}/comment`,
    DELETE_COMMENT: (commentId: string | number) => `/v1/social/post/comment/${safeParam(commentId)}`,
  },
  POSTS: {
    GET_SINGLE: (postId: string | number) => `/v1/social/post/${safeParam(postId)}`,
    DELETE: (postId: string | number) => `/v1/social/post/${postId}/delete`,
    VOTE: (postId: string | number, direction: string) => `/v1/social/post/${safeParam(postId)}/vote?direction=${direction}`,
    GET_COMMENTS: (postId: string | number, timestamp: number) => `/v1/social/post/${safeParam(postId)}/comments?t=${timestamp}`,
    CREATE_COMMENT: (postId: string | number) => `/v1/social/post/${safeParam(postId)}/comment`,
    DELETE_COMMENT: (commentId: string | number) => `/v1/social/post/comment/${safeParam(commentId)}`,
  },
  COMMENTS: {
    DELETE: (commentId: string | number) => `/v1/social/post/comment/${safeParam(commentId)}`,
  },
  MODERATION: {
    REPORT: '/v1/social/moderation/report',
  },
};

// ---------------------------------------------------------------------------
// Session handling
// ---------------------------------------------------------------------------
let onSessionExpiredCallback: (() => void) | null = null;
export const setSessionExpiredHandler = (handler: () => void) => { onSessionExpiredCallback = handler; };

const getStoredToken = async (): Promise<string | null> => {
  try {
    const token = await AsyncStorage.getItem('ghost_token');
    if (token) return token;
    return await AsyncStorage.getItem('@ghost_token');
  } catch { return null; }
};

// Clears the local session AND tells the UI (App.tsx registers the handler) so the login screen appears.
export const wipeSession = async () => {
  await AsyncStorage.multiRemove(['ghost_token', '@ghost_token', 'active_username', '@active_username', 'user_avatar', '@user_avatar']);
  if (onSessionExpiredCallback) onSessionExpiredCallback();
};

const sessionExpiredError = () => new Error('Session expired. Please log in again.');
const forbiddenError = () => new Error('Your account does not have permission to do that right now.');

const commonHeaders = (headers: Headers) => {
  headers.set('Accept', 'application/json');
  if (SHIELD_KEY) headers.set('X-Ghost-Shield-Key', SHIELD_KEY);
  headers.set('ngrok-skip-browser-warning', 'true');
};

// ---------------------------------------------------------------------------
// Multipart upload (posts, profile picture)
// ---------------------------------------------------------------------------
export const uploadMultipart = (endpoint: string, formData: FormData, onProgress?: (percent: number) => void): Promise<any> => {
  return new Promise(async (resolve, reject) => {
    const token = await getStoredToken();
    const xhr = new XMLHttpRequest();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    xhr.open('POST', `${BASE_URL}${cleanEndpoint}`);
    xhr.timeout = 5 * 60 * 1000;

    xhr.setRequestHeader('Accept', 'application/json');
    if (SHIELD_KEY) xhr.setRequestHeader('X-Ghost-Shield-Key', SHIELD_KEY);
    xhr.setRequestHeader('ngrok-skip-browser-warning', 'true');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event: any) => { if (event.lengthComputable && event.total > 0) onProgress(Math.round((event.loaded / event.total) * 100)); };
    }

    xhr.onload = async () => {
      let data: any = {};
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; }
      catch { data = { message: xhr.responseText }; }

      if (xhr.status === 401) { await wipeSession(); return reject(sessionExpiredError()); }
      if (xhr.status === 403) return reject(forbiddenError());
      if (xhr.status === 413) return reject(new Error('That file is too large.'));
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      reject(new Error(data.error || data.message || `Upload failed with status ${xhr.status}`));
    };

    xhr.onerror = () => reject(new Error('Network error during upload. Check your connection.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    try { xhr.send(formData as any); } catch (e: any) { reject(new Error(e?.message || 'Could not start upload.')); }
  });
};

export const buildFilePart = (asset: { uri: string; fileName?: string | null; mimeType?: string | null }) => {
  const name = asset.fileName || asset.uri.split('/').pop() || 'upload.jpg';
  const ext = name.split('.').pop()?.toLowerCase();
  const type = asset.mimeType || (ext === 'png' ? 'image/png' : ext === 'mp4' ? 'video/mp4' : ext === 'mov' ? 'video/quicktime' : 'image/jpeg');
  return { uri: asset.uri, name, type } as any;
};

// ---------------------------------------------------------------------------
// JSON client
// ---------------------------------------------------------------------------
export const apiClient = {
  async request(endpoint: string, options: RequestInit = {}) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${BASE_URL}${cleanEndpoint}`;
    const token = await getStoredToken();
    const headers = new Headers(options.headers || {});

    const isFormData = options.body != null && typeof (options.body as any).append === 'function';
    if (isFormData) throw new Error(`Use uploadMultipart() for multipart requests, not apiClient.`);

    headers.set('Content-Type', 'application/json');
    commonHeaders(headers);

    const isAuthRoute = endpoint.includes('/auth/login') || endpoint.includes('/auth/register') || endpoint.includes('/auth/check-username') || endpoint.includes('/auth/verify-otp') || endpoint.includes('/auth/forgot-password') || endpoint.includes('/auth/reset-password');
    if (token && !isAuthRoute) headers.set('Authorization', `Bearer ${token}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const config: RequestInit = { ...options, headers, signal: controller.signal };

    try {
      const response = await fetch(url, config);

      if (response.status === 401 && !isAuthRoute) {
        await wipeSession();
        throw sessionExpiredError();
      }
      if (response.status === 403 && !isAuthRoute) {
        // 403 on /auth/me means the account was blocked; any other 403 is a restricted (shadow-banned) write.
        if (endpoint.includes('/auth/me')) await wipeSession();
        throw forbiddenError();
      }

      const contentType = response.headers.get('content-type');
      let data;
      if (contentType && contentType.includes('application/json')) data = await response.json();
      else { const textData = await response.text(); data = { message: textData }; }

      if (!response.ok) throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
      return data;
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        const timeoutErr = new Error('The request timed out. Check your connection and try again.');
        console.warn(`[API] Timeout at [${endpoint}]`);
        throw timeoutErr;
      }
      console.warn(`[API] Issue at [${endpoint}]:`, error.message);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },
  get(endpoint: string, options?: RequestInit) { return this.request(endpoint, { ...options, method: 'GET' }); },
  post(endpoint: string, body?: any, options?: RequestInit) {
    const isFormData = body != null && typeof body.append === 'function';
    if (isFormData) throw new Error(`Use uploadMultipart() for multipart POSTs.`);
    return this.request(endpoint, { ...options, method: 'POST', body: body ? JSON.stringify(body) : undefined });
  },
  put(endpoint: string, body?: any, options?: RequestInit) {
    const isFormData = body != null && typeof body.append === 'function';
    if (isFormData) throw new Error(`Use uploadMultipart() for multipart PUTs.`);
    return this.request(endpoint, { ...options, method: 'PUT', body: body ? JSON.stringify(body) : undefined });
  },
  patch(endpoint: string, body?: any, options?: RequestInit) {
    const isFormData = body != null && typeof body.append === 'function';
    if (isFormData) throw new Error(`Use uploadMultipart() for multipart PATCHs.`);
    return this.request(endpoint, { ...options, method: 'PATCH', body: body ? JSON.stringify(body) : undefined });
  },
  delete(endpoint: string, options?: RequestInit) { return this.request(endpoint, { ...options, method: 'DELETE' }); },
};

export const systemLogout = async () => {
  try { await apiClient.post(API_ROUTES.AUTH.LOGOUT); }
  catch (error) {}
  finally { await wipeSession(); }
};

// Permanently deletes the account and all of its content on the server (Google Play requirement), then signs out locally.
export const deleteMyAccount = async () => {
  await apiClient.delete(API_ROUTES.SOCIAL.DELETE_ACCOUNT);
  await wipeSession();
};

// Registers this phone's push (FCM) token with the server so chat messages can wake the app when it is closed.
export const syncDeviceToken = async () => {
  if (Platform.OS !== 'android') return;

  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    // Raw Firebase token (FCM), NOT the Expo push token
    const tokenData = await Notifications.getDevicePushTokenAsync();
    const fcmToken = tokenData.data;

    await apiClient.put('/v1/auth/profile/device-token', { fcmToken });
  } catch (error) {
    console.warn('Failed to sync device token:', error);
  }
};
