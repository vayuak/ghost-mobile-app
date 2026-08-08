import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// 🟢 EDGE GATEWAY DISCOVERY
//export const BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://localhost:8080';
export const BASE_URL = Platform.OS === 'android' ? 'https://mode-production-6bbb.up.railway.app' : 'https://mode-production-6bbb.up.railway.app';
// 🔑 Insert your actual Gemini API Key here
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY_HERE'; 

// 🟢 Session Expired Callback Listener
let onSessionExpiredCallback: (() => void) | null = null;

export const setSessionExpiredHandler = (handler: () => void) => {
  onSessionExpiredCallback = handler;
};

export const apiClient = {
  async request(endpoint: string, options: RequestInit = {}) {
    const url = `${BASE_URL}${endpoint}`;
    
    // 🟢 UNIFIED KEY: Always use '@ghost_token' across the entire app
    const token = await AsyncStorage.getItem('@ghost_token');

    const headers = new Headers(options.headers || {});
    
    if (!(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    headers.set('X-Ghost-Shield-Key', 'PermanentSecret999');
    
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const config: RequestInit = {
      ...options,
      headers
    };

    try {
      const response = await fetch(url, config);
      
      // 🟢 AUTO-LOGOUT TRIGGER: If backend drops security, wipe token and notify App.tsx
      if (response.status === 401 || response.status === 403) {
        await AsyncStorage.removeItem('@ghost_token');
        await AsyncStorage.removeItem('@active_username');
        await AsyncStorage.removeItem('@user_avatar');
        
        if (onSessionExpiredCallback) {
          onSessionExpiredCallback();
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
    const isFormData = body instanceof FormData;
    return this.request(endpoint, { 
      ...options, 
      method: 'POST', 
      body: isFormData ? body : (body ? JSON.stringify(body) : undefined) 
    });
  },

  put(endpoint: string, body?: any, options?: RequestInit) {
    const isFormData = body instanceof FormData;
    return this.request(endpoint, { 
      ...options, 
      method: 'PUT', 
      body: isFormData ? body : (body ? JSON.stringify(body) : undefined) 
    });
  },

  delete(endpoint: string, options?: RequestInit) {
    return this.request(endpoint, {
      ...options,
      method: 'DELETE',
    });
  },

  // ✨ Gemini AI Integration
  async askGemini(prompt: string, systemInstruction?: string) {
    if (!GEMINI_API_KEY || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
      throw new Error("Missing Gemini API Key in api.ts");
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const payload: any = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    if (systemInstruction) {
      payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || "Gemini API failure");
      }

      return data.candidates[0].content.parts[0].text;
    } catch (err: any) {
      console.error("Gemini API Error:", err.message);
      throw err;
    }
  }
}; 

// 🟢 systemLogout safely exported outside the object
export const systemLogout = async () => {
  try {
    // 1. Notify Spring Boot to blacklist the JWT in Redis
    await apiClient.post('/v1/auth/logout');
  } catch (error) {
    console.warn("Backend logout unreachable, forcing local wipe.", error);
  } finally {
    // 2. Wipe the local storage credentials completely
    await AsyncStorage.multiRemove([
      '@ghost_token', 
      '@active_username', 
      '@user_avatar'
    ]);
    
    // 3. Trigger App.tsx to unmount the TabNavigator and show AuthScreen
    if (onSessionExpiredCallback) {
      onSessionExpiredCallback();
    }
  }
};