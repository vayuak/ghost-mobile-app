import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Image, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'; 
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client } from '@stomp/stompjs';
import { Feather } from '@expo/vector-icons';
import { apiClient, BASE_URL, P2P_WS_URL } from '../services/api';
import { initLocalDatabase, saveLocalMessage, getLocalMessages } from '../services/LocalDB';
import {
  ensureKeysPublished,
  encryptForPeer,
  decryptFromPeer,
  getPeerPublicKey,
  acceptPeerKeyChange,
  safetyNumber,
  KeyChangedError,
  NoKeyError,
  CRYPTO_VERSION,
} from '../services/CryptoVault';

// 🟢 CRITICAL POLYFILL: Polyfills TextEncoder/Decoder for React Native
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = class {
    encode(str: string) {
      const buffer = new ArrayBuffer(str.length);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < str.length; i++) view[i] = str.charCodeAt(i);
      return view;
    }
  } as any;
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = class {
    decode(arr: Uint8Array) {
      let str = '';
      for (let i = 0; i < arr.length; i++) {
        str += String.fromCharCode(arr[i]);
      }
      return str;
    }
  } as any;
}

interface MessageItem {
  msgId?: string;
  sender_username: string;
  content: string;
  timestamp: string;
  undecryptable?: boolean;
}

type CryptoState = 'checking' | 'ready' | 'peer-has-no-key' | 'key-changed' | 'error';

export default function GossipsChatScreen({ route, navigation }: any): React.JSX.Element {
  const targetUser = (route.params?.targetUser || '').trim().toLowerCase();
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeUser, setActiveUser] = useState('');
  const [targetAvatar, setTargetAvatar] = useState<string | null>(null);

  const [isConnecting, setIsConnecting] = useState(true);
  const [isLinkActive, setIsLinkActive] = useState(false);
  const [cryptoState, setCryptoState] = useState<CryptoState>('checking');
  const [sending, setSending] = useState(false);

  const clientRef = useRef<Client | null>(null);
  const roomIdRef = useRef<string>('');
  const activeUserRef = useRef<string>('');
  const scrollViewRef = useRef<ScrollView>(null);
  
  // 🟢 The Offline Message Queue
  const pendingOutboundRef = useRef<any[]>([]);

  const scrollToEnd = (animated = true) => {
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated }), 100);
  };

  useEffect(() => {
    let isMounted = true;

    try {
      initLocalDatabase();
    } catch (e) {
      console.warn('[Chat] Local database init failed:', e);
    }

    const boot = async () => {
      try {
        const storedUser = (await AsyncStorage.getItem('@active_username')) || '';
        const me = storedUser.trim().toLowerCase();

        if (!isMounted) return;
        setActiveUser(me);
        activeUserRef.current = me;

        if (!targetUser || !me) {
          setIsConnecting(false);
          setCryptoState('error');
          return;
        }

        try {
          await ensureKeysPublished();
        } catch (e) {
          console.warn('[Chat] Key publication non-fatal warn:', e);
        }

        if (!isMounted) return;

        try {
          await getPeerPublicKey(targetUser);
          if (isMounted) setCryptoState('ready');
        } catch (e) {
          if (!isMounted) return;
          if (e instanceof KeyChangedError) setCryptoState('key-changed');
          else if (e instanceof NoKeyError) setCryptoState('peer-has-no-key');
          else setCryptoState('error');
        }

        fetchTargetProfile();
        connect(me);
      } catch (globalError) {
        console.error('[Chat] Critical boot failure:', globalError);
        setIsConnecting(false);
      }
    };

    boot();

    return () => {
      isMounted = false;
      if (clientRef.current) {
        clientRef.current.deactivate();
        clientRef.current = null;
      }
    };
  }, [targetUser]);

  const fetchTargetProfile = async () => {
    try {
      const res = await apiClient.get(`/v1/social/user/${targetUser}/profile`);
      const rawPic = res.avatarUrl || res.profilePictureUrl || res.data?.avatarUrl;
      if (rawPic && typeof rawPic === 'string' && rawPic.trim() !== '') {
        setTargetAvatar(rawPic.startsWith('http') ? rawPic : `${BASE_URL}${rawPic}`);
      } else {
        setTargetAvatar(null);
      }
    } catch {
      setTargetAvatar(null);
    }
  };
const connect = async (me: string) => {
    setIsConnecting(true);

    if (clientRef.current) {
      clientRef.current.deactivate();
      clientRef.current = null;
    }

    const token = await AsyncStorage.getItem('@ghost_token');
    if (!token) {
      setIsConnecting(false);
      return;
    }

    const roomId = [me, targetUser].sort().join('_');
    roomIdRef.current = roomId;
    loadLocalHistory(roomId);

    const client = new Client({
      // 🟢 THE ULTIMATE ANDROID NULL-BYTE BYPASS
      webSocketFactory: () => {
        const ws = new WebSocket(P2P_WS_URL);
        const originalSend = ws.send.bind(ws);
        
        ws.send = (data: any) => {
          if (typeof data === 'string') {
            // Android strips '\0' from text WebSockets. 
            // We forcefully convert the string into a binary ArrayBuffer.
            // This protects the STOMP null-terminator so Spring Boot can parse it.
            const encoder = new TextEncoder();
            const uint8Array = encoder.encode(data);
            originalSend(uint8Array.buffer);
          } else if (data && data.buffer instanceof ArrayBuffer) {
            // If it's already binary, safely extract the pure ArrayBuffer
            originalSend(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
          } else {
            originalSend(data);
          }
        };
        return ws;
      },
      
      connectHeaders: { Authorization: `Bearer ${token}` },
      debug: (str) => console.log('[STOMP]', str),
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      reconnectDelay: 5000,

      onConnect: () => {
        setIsLinkActive(true);
        setIsConnecting(false);

        // 🟢 Flush the offline message queue the moment we connect
        const pending = pendingOutboundRef.current;
        if (pending.length > 0) {
          pending.forEach(payload => {
            client.publish({
              destination: '/app/shadow/send',
              body: JSON.stringify(payload)
            });
          });
          // Empty the queue after sending
          pendingOutboundRef.current = [];
        }

        client.subscribe(`/topic/shadow-${roomId}`, async (frame) => {
          let payload: any;
          try {
            payload = JSON.parse(frame.body);
          } catch {
            return;
          }

          const sender = (payload.senderUsername || '').trim().toLowerCase();
          if (sender === activeUserRef.current) return;

          const plaintext = await decryptFromPeer(
            {
              v: payload.v ?? CRYPTO_VERSION,
              ciphertext: payload.ciphertext || payload.encryptedPayload,
              iv: payload.iv,
              senderPublicKey: payload.ephemeralPublicKey,
            },
            sender || targetUser
          );

          setMessages((prev) => {
            if (payload.msgId && prev.some((m) => m.msgId === payload.msgId)) return prev;

            if (plaintext === null) {
              return [...prev, {
                msgId: payload.msgId,
                sender_username: sender || targetUser,
                content: 'Message could not be verified',
                timestamp: new Date().toISOString(),
                undecryptable: true,
              }];
            }

            try {
              saveLocalMessage(payload.roomId || roomId, sender || targetUser, plaintext, null, null, activeUserRef.current);
            } catch (e) {
              console.warn('[Chat] Could not persist message:', e);
            }

            return [...prev, {
              msgId: payload.msgId,
              sender_username: sender || targetUser,
              content: plaintext,
              timestamp: new Date().toISOString(),
            }];
          });

          scrollToEnd();
        });
      },

      onDisconnect: () => {
        setIsLinkActive(false);
        setIsConnecting(true);
      },
      onWebSocketClose: () => {
        setIsLinkActive(false);
        setIsConnecting(true);
      },
      onStompError: (frame) => {
        console.error('[Chat] Broker error:', frame.headers?.['message'], frame.body);
        setIsLinkActive(false);
        setIsConnecting(false);
      },
    });

    clientRef.current = client;
    client.activate();
  };

  const loadLocalHistory = (roomId: string) => {
    try {
      const history = getLocalMessages(roomId);
      setMessages(Array.isArray(history) ? history : []);
      scrollToEnd(false);
    } catch (e) {
      console.warn('[Chat] Could not load local history:', e);
      setMessages([]);
    }
  };

  const handleSend = async () => {
    const text = chatInput.trim();

    // Do not block sending if STOMP is reconnecting
    if (!text || !activeUserRef.current || sending) return;
    if (cryptoState !== 'ready') return;

    setSending(true);
    const roomId = roomIdRef.current;
    const clientMsgId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const envelope = await encryptForPeer(text, targetUser);
      const payloadObj = {
        v: envelope.v,
        msgId: clientMsgId,
        roomId,
        senderUsername: activeUserRef.current,
        targetUsername: targetUser,
        senderId: 0,
        ephemeralPublicKey: envelope.senderPublicKey,
        ciphertext: envelope.ciphertext,
        encryptedPayload: envelope.ciphertext,
        iv: envelope.iv,
        authTag: '',
      };

      // Instantly drop the message into the SQLite DB and UI
      saveLocalMessage(roomId, activeUserRef.current, text, null, null, targetUser);
      setMessages((prev) => [...prev, {
        msgId: clientMsgId,
        sender_username: activeUserRef.current,
        content: text,
        timestamp: new Date().toISOString(),
      }]);

      setChatInput('');
      scrollToEnd();

      // If online, send immediately. If offline, push to queue.
      const client = clientRef.current;
      if (client?.connected) {
        client.publish({
          destination: '/app/shadow/send',
          body: JSON.stringify(payloadObj),
        });
      } else {
        pendingOutboundRef.current.push(payloadObj);
      }
      
    } catch (e: any) {
      if (e instanceof KeyChangedError) {
        setCryptoState('key-changed');
      } else if (e instanceof NoKeyError) {
        setCryptoState('peer-has-no-key');
      } else {
        Alert.alert('Could not send', e?.message || 'Encryption failed.');
      }
    } finally {
      setSending(false);
    }
  };

  const handleAcceptKeyChange = async () => {
    try {
      await acceptPeerKeyChange(targetUser);
      setCryptoState('ready');
    } catch {
      setCryptoState('error');
    }
  };

  const showSafetyNumber = async () => {
    const num = await safetyNumber(targetUser);
    Alert.alert(
      'Safety number',
      num
        ? `${num}\n\nCompare this with @${targetUser} in person or over a call you trust. If the numbers match, no one is intercepting your messages.`
        : 'Not available until both of you have published keys.'
    );
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const canType = cryptoState === 'ready';

  const renderBanner = () => {
    if (cryptoState === 'ready') {
      return (
        <TouchableOpacity style={[styles.banner, styles.bannerOk]} onPress={showSafetyNumber}>
          <Feather name="lock" size={12} color="#00C851" />
          <Text style={[styles.bannerText, { color: '#00C851' }]}>
            {' '}End-to-end encrypted. Tap to verify safety number.
          </Text>
        </TouchableOpacity>
      );
    }
    if (cryptoState === 'key-changed') {
      return (
        <TouchableOpacity style={[styles.banner, styles.bannerDanger]} onPress={handleAcceptKeyChange}>
          <Feather name="alert-triangle" size={12} color="#FF3B30" />
          <Text style={[styles.bannerText, { color: '#FF3B30' }]}>
            {' '}@{targetUser}'s encryption key changed. Tap here to trust new key.
          </Text>
        </TouchableOpacity>
      );
    }
    if (cryptoState === 'peer-has-no-key') {
      return (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Feather name="clock" size={12} color="#D1B000" />
          <Text style={[styles.bannerText, { color: '#D1B000' }]}>
            {' '}Waiting for @{targetUser} to publish encryption keys.
          </Text>
        </View>
      );
    }
    if (cryptoState === 'checking') {
      return (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Feather name="loader" size={12} color="#8E95A5" />
          <Text style={[styles.bannerText, { color: '#8E95A5' }]}> Establishing encryption keys...</Text>
        </View>
      );
    }
    return (
      <View style={[styles.banner, styles.bannerDanger]}>
        <Feather name="alert-triangle" size={12} color="#FF3B30" />
        <Text style={[styles.bannerText, { color: '#FF3B30' }]}> Encryption unavailable. Messages cannot be sent.</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('MainTabs'))}
          >
            <Feather name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.activeHeader}>
            <View style={styles.avatarPlaceholder}>
              {targetAvatar ? (
                <Image source={{ uri: targetAvatar }} style={{ width: '100%', height: '100%' }} />
              ) : (
                <Text style={styles.avatarText}>{targetUser ? targetUser[0]?.toUpperCase() : '?'}</Text>
              )}
            </View>
            <View>
              <Text style={styles.headerTextActive}>@{targetUser || 'unknown'}</Text>
              <Text style={styles.statusText}>
                {isConnecting ? 'connecting...' : isLinkActive ? 'connected' : 'offline'}
              </Text>
            </View>
          </View>
        </View>

        <ScrollView ref={scrollViewRef} style={styles.chatArea} contentContainerStyle={{ paddingBottom: 20 }}>
          {renderBanner()}

          {messages.map((msg, idx) => {
            const msgSender = (msg.sender_username || '').trim().toLowerCase();
            const isMe = msgSender === activeUser;

            return (
              <View key={msg.msgId || idx} style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.theirBubbleWrapper]}>
                <View style={[
                  styles.bubble,
                  isMe ? styles.myBubble : styles.theirBubble,
                  msg.undecryptable ? styles.badBubble : null,
                ]}>
                  <Text style={[
                    styles.bubbleText,
                    { color: '#E9EDEF' },
                    msg.undecryptable ? styles.badBubbleText : null,
                  ]}>
                    {msg.content}
                  </Text>
                  <Text style={[styles.timestamp, isMe ? styles.myTimestamp : styles.theirTimestamp]}>
                    {msg.timestamp ? formatTime(msg.timestamp) : formatTime(new Date().toISOString())}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.inputRow, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TextInput
            style={styles.input}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder={cryptoState !== 'ready' ? 'Encryption syncing...' : 'Message...'}
            placeholderTextColor="#666666"
            editable={canType}
            multiline
          />

          <TouchableOpacity
            style={[styles.sendBtn, (!chatInput.trim() || !canType) && { backgroundColor: '#262626' }]}
            onPress={handleSend}
            disabled={!canType || !chatInput.trim() || sending}
          >
            <Feather name="send" size={20} color={chatInput.trim() && canType ? '#FFFFFF' : '#666666'} style={{ marginLeft: -2 }} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: { flex: 1, backgroundColor: '#1A1A1A' },
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#1A1A1A', borderBottomWidth: 1, borderColor: '#262626' },
  backBtn: { marginRight: 16 },
  activeHeader: { flexDirection: 'row', alignItems: 'center' },
  avatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  avatarText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  headerTextActive: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  statusText: { fontSize: 11, color: '#00C851', fontWeight: '600' },
  chatArea: { flex: 1, padding: 16 },
  banner: { flexDirection: 'row', padding: 10, borderRadius: 8, marginBottom: 20, alignItems: 'center', justifyContent: 'center' },
  bannerOk: { backgroundColor: 'rgba(0, 200, 81, 0.1)' },
  bannerWarn: { backgroundColor: 'rgba(209, 176, 0, 0.1)' },
  bannerDanger: { backgroundColor: 'rgba(255, 59, 48, 0.1)' },
  bannerText: { fontSize: 11, textAlign: 'center', fontWeight: '600', flexShrink: 1 },
  bubbleWrapper: { marginBottom: 12, flexDirection: 'row', width: '100%' },
  myBubbleWrapper: { justifyContent: 'flex-end' },
  theirBubbleWrapper: { justifyContent: 'flex-start' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, maxWidth: '75%' },
  myBubble: { backgroundColor: '#005C4B', borderTopRightRadius: 4 },
  theirBubble: { backgroundColor: '#202C33', borderTopLeftRadius: 4 },
  badBubble: { backgroundColor: '#2A1A1A', borderWidth: 1, borderColor: '#5C2A2A' },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  badBubbleText: { color: '#FF8A80', fontStyle: 'italic' },
  timestamp: { fontSize: 10, alignSelf: 'flex-end', marginTop: 4, marginLeft: 12 },
  myTimestamp: { color: 'rgba(255,255,255,0.6)' },
  theirTimestamp: { color: 'rgba(255,255,255,0.5)' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, backgroundColor: '#1A1A1A' },
  input: { flex: 1, backgroundColor: '#2A2F32', borderRadius: 24, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, color: '#FFFFFF', fontSize: 15, maxHeight: 100, minHeight: 48 },
  sendBtn: { backgroundColor: '#00A884', width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
});