import { Client } from '@stomp/stompjs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
// import { saveMessageLocally } from './LocalDB'; // You will wire your SQLite here later

// Match the port your backend WebSocket is running on (8096 in your logs)
//const WS_BASE_URL = Platform.OS === 'android' ? 'ws://10.0.2.2:8096' : 'ws://localhost:8096';
const WS_BASE_URL = 'wss://mode-production-6bbb.up.railway.app';
class WebSocketManager {
  private client: Client | null = null;
  private isConnected: boolean = false;
  private reconnectDelay: number = 3000;
  private activeSubscriptions: Map<string, any> = new Map();

  // 1. Initialize the connection
  public async connect() {
    if (this.isConnected) return;

    const token = await AsyncStorage.getItem('@ghost_token');
    const username = await AsyncStorage.getItem('@active_username');

    if (!token || !username) {
      console.warn("[WebSocket] No auth tokens found, aborting connection.");
      return;
    }

    this.client = new Client({
      brokerURL: `${WS_BASE_URL}/ws-chat`,
      connectHeaders: {
        Authorization: `Bearer ${token}`,
        username: username,
      },
      reconnectDelay: this.reconnectDelay,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      
      onConnect: () => {
        console.log(`✅ [WebSocket] Connected securely as ${username}`);
        this.isConnected = true;
        
        // Example: Automatically subscribe to a global user-specific queue for incoming Mailbox messages
        this.subscribeToQueue(`/user/${username}/queue/messages`, this.handleIncomingMessage);
      },
      
      onStompError: (frame) => {
        console.error('❌ [WebSocket] Broker reported error: ' + frame.headers['message']);
        console.error('❌ [WebSocket] Additional details: ' + frame.body);
      },
      
      onWebSocketClose: () => {
        console.warn('⚠️ [WebSocket] Connection lost. Auto-reconnecting...');
        this.isConnected = false;
      }
    });

    this.client.activate();
  }

  // 2. Handle incoming messages in the background
  private handleIncomingMessage = async (message: any) => {
    if (message.body) {
      const payload = JSON.parse(message.body);
      console.log("📥 [WebSocket] Background Message Received:", payload);
      
      // TODO: Drop this directly into SQLite
      // await saveMessageLocally(payload.roomId, payload.sender, payload.encryptedContent);
    }
  };

  // 3. Subscribe to specific chat rooms when the user opens them
  public subscribeToQueue(destination: string, callback: (message: any) => void) {
    if (!this.client || !this.client.connected) {
      console.warn(`[WebSocket] Cannot subscribe to ${destination} - not connected.`);
      return;
    }

    if (this.activeSubscriptions.has(destination)) return; // Already subscribed

    const subscription = this.client.subscribe(destination, callback);
    this.activeSubscriptions.set(destination, subscription);
    console.log(`📡 [WebSocket] Subscribed to ${destination}`);
  }

  // 4. Send a message to the zero-trust relay
  public sendMessage(destination: string, body: any) {
    if (!this.client || !this.client.connected) {
      console.error("[WebSocket] Cannot send message, not connected.");
      return;
    }
    this.client.publish({ destination, body: JSON.stringify(body) });
  }

  // 5. Clean up on logout
  public disconnect() {
    if (this.client) {
      this.client.deactivate();
      this.isConnected = false;
      this.activeSubscriptions.clear();
      console.log("🔌 [WebSocket] Disconnected successfully.");
    }
  }
}

export const globalSocket = new WebSocketManager();