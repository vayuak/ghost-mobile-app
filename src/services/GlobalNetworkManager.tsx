import React, { createContext, useContext, useEffect, useRef } from 'react';
import { AppState, DeviceEventEmitter, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client, IMessage } from '@stomp/stompjs';
import * as Notifications from 'expo-notifications';
import Toast from 'react-native-toast-message';
import { P2P_WS_URL, apiClient } from './api';
import { saveLocalMessage, hasLocalMessage, isUserBlocked, getPendingOutgoing, setMessageStatus } from './LocalDB';
import { decryptFromPeer, encryptForPeer } from './CryptoVault';
import { currentActiveChat } from '../screens/GossipsChatScreen';
import { peekAvatarUrl, getAvatarUrl } from './ProfileCache';

type Receipt = 'delivered' | 'read';
type Ctx = { kickOutbox: () => void; resync: () => void; sendReceipt: (sender: string, msgIds: string[], s: Receipt) => void };
const NetworkContext = createContext<Ctx>({ kickOutbox: () => {}, resync: () => {}, sendReceipt: () => {} });
export const useNetwork = () => useContext(NetworkContext);

export const GlobalNetworkManager: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const clientRef = useRef<Client | null>(null);
  const startingRef = useRef(false);
  const flushingRef = useRef(false);
  const inFlight = useRef(new Set<string>());
  const meRef = useRef('');

  const publish = (destination: string, body: any): boolean => {
    const c = clientRef.current;
    if (!c?.connected) return false;
    c.publish({ destination, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return true;
  };

  const sendReceipt = (sender: string, msgIds: string[], status: Receipt) => {
    for (const msgId of msgIds) publish('/app/shadow/receipt', { msgId, targetUsername: sender, status });
  };

  // Outbox: every outgoing message is saved as 'pending' first, then sent from here.
  // The chat server stores the encrypted message and sends the push notification itself, so the app does not trigger pushes.
  const flushOutbox = async () => {
    if (flushingRef.current || !clientRef.current?.connected) return;
    flushingRef.current = true;
    try {
      for (const row of getPendingOutgoing(meRef.current)) {
        try {
          const env = await encryptForPeer(row.content, row.target);
          const ok = publish('/app/shadow/send', {
            v: env.v, msgId: row.msgId, roomId: row.roomId, senderUsername: meRef.current,
            targetUsername: row.target, sentAt: row.sentAt,
            ephemeralPublicKey: env.senderPublicKey, ciphertext: env.ciphertext, iv: env.iv,
          });

          if (!ok) break; // socket dropped; row stays 'pending' and goes out on the next connect
        } catch {
          setMessageStatus(row.msgId, 'failed');
        }
      }
    } finally { flushingRef.current = false; }
  };

  const processIncomingPayload = async (payload: any, me: string, isBulkSync: boolean)
    : Promise<'saved' | 'duplicate' | 'blocked' | 'undecryptable'> => {
    const sender = (payload.senderUsername || '').trim().toLowerCase();
    const msgId: string | undefined = payload.msgId;
    if (!sender || sender === me) return 'duplicate';
    if (msgId && (hasLocalMessage(msgId) || inFlight.current.has(msgId))) return 'duplicate';
    if (isUserBlocked(sender)) return 'blocked';
    if (msgId) inFlight.current.add(msgId);
    try {
      const plaintext = await decryptFromPeer({
        v: payload.v, ciphertext: payload.ciphertext || payload.encryptedPayload,
        iv: payload.iv, senderPublicKey: payload.ephemeralPublicKey,
      }, sender);
      if (!plaintext) return 'undecryptable';

      const roomId = payload.roomId || [me, sender].sort().join('_');
      const appActive = AppState.currentState === 'active';
      const isReading = appActive && sender === currentActiveChat;
      saveLocalMessage(roomId, sender, plaintext, null, null, me, msgId ?? null,
        payload.sentAt || new Date().toISOString(), isBulkSync, isReading);
      if (msgId) sendReceipt(sender, [msgId], isReading ? 'read' : 'delivered');
      if (!peekAvatarUrl(sender)) getAvatarUrl(sender).catch(() => {});

      if (!isBulkSync && !isReading && Platform.OS !== 'web') {
        const preview = plaintext.startsWith('DATA_IMAGE::') ? '📷 Photo' : plaintext;
        if (appActive) {
          Toast.show({ type: 'info', text1: `@${sender}`, text2: preview, position: 'top', topOffset: 55, visibilityTime: 4000 });
        } else {
          await Notifications.scheduleNotificationAsync({
            content: { title: `@${sender}`, body: preview, sound: true },
            trigger: Platform.OS === 'android' ? { channelId: 'messages' } : null,
          });
        }
      }
      return 'saved';
    } finally {
      if (msgId) inFlight.current.delete(msgId);
    }
  };

  const syncOfflineMessages = async (me: string) => {
    const missed = await apiClient.get('/v1/p2p/sync');
    if (!Array.isArray(missed) || missed.length === 0) return;
    const ackIds: string[] = [];
    for (const m of missed) {
      const r = await processIncomingPayload(m, me, true);
      if (r !== 'undecryptable' && m.msgId) ackIds.push(m.msgId); // never ACK what we couldn't decrypt
    }
    if (ackIds.length) await apiClient.post('/v1/p2p/sync/ack', ackIds);
    DeviceEventEmitter.emit('db_chats_updated');
  };

  const onFrame = (me: string) => async (frame: IMessage) => {
    let body: any;
    try { body = JSON.parse(frame.body); } catch { return; }
    if (body.type === 'ACK') return setMessageStatus(body.msgId, 'sent');
    if (body.type === 'NACK') return setMessageStatus(body.msgId, 'failed');
    if (body.type === 'RECEIPT') return setMessageStatus(body.msgId, body.status);
    await processIncomingPayload(body, me, false);
  };

  useEffect(() => {
    let disposed = false;

    const start = async () => {
      if (clientRef.current || startingRef.current) return;
      startingRef.current = true;
      try {
        const me = (await AsyncStorage.getItem('@active_username'))?.trim().toLowerCase();
        const token = await AsyncStorage.getItem('@ghost_token');
        if (!me || !token || disposed) return;
        meRef.current = me;

        const client: Client = new Client({
          brokerURL: P2P_WS_URL,
          forceBinaryWSFrames: true,
          appendMissingNULLonIncoming: true,
          heartbeatIncoming: 20000,
          heartbeatOutgoing: 20000,
          reconnectDelay: 3000,
          connectionTimeout: 10000,
          debug: __DEV__ ? (s) => console.log('[STOMP]', s) : () => {},
          beforeConnect: async () => {
            const t = await AsyncStorage.getItem('@ghost_token');
            client.connectHeaders = { Authorization: `Bearer ${t}` };
          },
          onConnect: () => {
            client.subscribe(`/topic/shadow-user-${me}`, onFrame(me));
            syncOfflineMessages(me).catch(e => console.warn('[SYNC]', e?.message)).finally(flushOutbox);
          },
          onStompError: f => console.warn('[STOMP] ERROR frame:', f.headers['message']),
          onWebSocketClose: e => { if (__DEV__) console.log('[STOMP] socket closed', e?.code, e?.reason); },
        });
        clientRef.current = client;
        client.activate();
      } finally {
        startingRef.current = false;
      }
    };

    start();

    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const c = clientRef.current;
      if (!c) return void start();
      if (c.connected) {
        syncOfflineMessages(meRef.current).catch(() => {});
      } else {
        clientRef.current = null;
        c.deactivate().finally(start);
      }
    });

    return () => {
      disposed = true;
      sub.remove();
      clientRef.current?.deactivate();
      clientRef.current = null;
    };
  }, []);

  return (
    <NetworkContext.Provider value={{
      kickOutbox: () => { flushOutbox(); },
      resync: () => { if (meRef.current) syncOfflineMessages(meRef.current).catch(() => {}); },
      sendReceipt,
    }}>
      {children}
    </NetworkContext.Provider>
  );
};
