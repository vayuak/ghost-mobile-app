import React, { createContext, useContext, useEffect, useRef } from 'react';
import { AppState, DeviceEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client } from '@stomp/stompjs';
import * as Notifications from 'expo-notifications'; 
import { P2P_WS_URL, apiClient } from './api';
import { saveLocalMessage, hasLocalMessage, isUserBlocked } from './LocalDB';
import { decryptFromPeer } from './CryptoVault';
import { currentActiveChat } from '../screens/GossipsChatScreen';
import { peekAvatarUrl, getAvatarUrl } from './ProfileCache'; 

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true, 
    shouldShowList: true,   
  }),
});

interface NetworkContextType {
  sendStompMessage: (destination: string, body: any) => void;
}
const NetworkContext = createContext<NetworkContextType>({ sendStompMessage: () => {} });
export const useNetwork = () => useContext(NetworkContext);

export const GlobalNetworkManager: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const clientRef = useRef<Client | null>(null);

  const sendStompMessage = (destination: string, body: any) => {
    if (clientRef.current?.connected) {
      clientRef.current.publish({ destination, body: JSON.stringify(body) });
    } else {
      console.warn('[GLOBAL] Cannot send, STOMP disconnected.');
    }
  };

  useEffect(() => {
    let isActive = true;

    const processIncomingPayload = async (payload: any, me: string, isBulkSync: boolean = false) => {
      const sender = (payload.senderUsername || '').trim().toLowerCase();
      if (sender === me) return; 
      if (payload.msgId && hasLocalMessage(payload.msgId)) return;
      if (isUserBlocked(sender)) return; 

      try {
        const plaintext = await decryptFromPeer(
          {
            v: payload.v,
            ciphertext: payload.ciphertext || payload.encryptedPayload,
            iv: payload.iv,
            senderPublicKey: payload.ephemeralPublicKey,
          },
          sender
        );

        if (plaintext) {
          const roomId = payload.roomId || [me, sender].sort().join('_');
          const originTs = payload.sentAt || new Date().toISOString();
          
          saveLocalMessage(roomId, sender, plaintext, null, null, me, payload.msgId, originTs, isBulkSync);
          
          // 🟢 SILENT FETCH: If the avatar is missing locally, grab it now!
          if (!peekAvatarUrl(sender)) {
             getAvatarUrl(sender).catch(() => {});
          }

          if (!isBulkSync && Platform.OS !== 'web' && sender !== currentActiveChat) {
            const isImage = plaintext.startsWith('DATA_IMAGE::');
            await Notifications.scheduleNotificationAsync({
              content: {
                title: `@${sender}`,
                body: isImage ? '📷 Sent an image' : plaintext,
                sound: true,
              },
              trigger: null, 
            });
          }
        }
      } catch (e) {}
    };

    const syncOfflineMessages = async (me: string) => {
      try {
        const missedMessages = await apiClient.get('/v1/p2p/sync');
        if (Array.isArray(missedMessages) && missedMessages.length > 0) {
          const processedIds: string[] = [];
          
          for (const msg of missedMessages) {
            await processIncomingPayload(msg, me, true);
            if (msg.msgId) processedIds.push(msg.msgId);
          }

          if (processedIds.length > 0) {
            await apiClient.post('/v1/p2p/sync/ack', processedIds);
            DeviceEventEmitter.emit('db_chats_updated');
          }
        }
      } catch (e) {}
    };

    const connectGlobalStomp = async () => {
      const token = await AsyncStorage.getItem('@ghost_token');
      const me = (await AsyncStorage.getItem('@active_username'))?.trim().toLowerCase();
      if (!token || !me) return;

      await syncOfflineMessages(me);

      const client = new Client({
        brokerURL: P2P_WS_URL,
        connectHeaders: { Authorization: `Bearer ${token}` },
        heartbeatIncoming: 25000,
        heartbeatOutgoing: 25000,
        reconnectDelay: 5000,
        
        onConnect: () => {
          client.subscribe(`/topic/shadow-user-${me}`, async (frame) => {
            try { await processIncomingPayload(JSON.parse(frame.body), me); } catch (e) { }
          });
        }
      });

      client.activate();
      clientRef.current = client;
    };

    connectGlobalStomp();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && !clientRef.current?.connected) connectGlobalStomp();
    });

    return () => {
      isActive = false;
      clientRef.current?.deactivate();
      subscription.remove();
    };
  }, []);

  return (
    <NetworkContext.Provider value={{ sendStompMessage }}>
      {children}
    </NetworkContext.Provider>
  );
};