import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Image, Alert } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'; 
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client } from '@stomp/stompjs';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { apiClient, BASE_URL, P2P_WS_URL } from '../services/api';
import { initLocalDatabase, saveLocalMessage, getLocalMessages } from '../services/LocalDB';
import { ensureKeysPublished, encryptForPeer, decryptFromPeer, getPeerPublicKey, acceptPeerKeyChange, safetyNumber, KeyChangedError, NoKeyError, CRYPTO_VERSION } from '../services/CryptoVault';

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
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  const [isConnecting, setIsConnecting] = useState(true);
  const [isLinkActive, setIsLinkActive] = useState(false);
  const [cryptoState, setCryptoState] = useState<CryptoState>('checking');
  const [sending, setSending] = useState(false);

  const clientRef = useRef<Client | null>(null);
  const roomIdRef = useRef<string>('');
  const activeUserRef = useRef<string>('');
  const scrollViewRef = useRef<ScrollView>(null);
  const pendingOutboundRef = useRef<any[]>([]);

  // 🟢 GATEWAY SHIELD KEY
  const shieldKey = process.env.EXPO_PUBLIC_SHIELD_KEY || 'PermanentSecret999';

  const scrollToEnd = (animated = true) => {
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated }), 100);
  };

  const resolveAvatarUrl = (rawPic: any) => {
    if (!rawPic || typeof rawPic !== 'string' || rawPic.trim() === '') return null;
    if (rawPic.startsWith('http') || rawPic.startsWith('file://') || rawPic.startsWith('data:')) return rawPic;
    const cleanBase = BASE_URL.replace(/\/$/, '');
    const cleanPath = rawPic.replace(/^\//, '');
    return `${cleanBase}/${cleanPath}`;
  };

  // 🟢 FIX: Added Shield Key to bypass API Gateway 401/403 blocks for Chat DPs
  const getSecureImageSource = (uri: string) => {
    if (Platform.OS === 'web' || uri.includes('amazonaws.com')) return { uri };
    return { 
      uri, 
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        'X-Ghost-Shield-Key': shieldKey
      }
    };
  };

  useEffect(() => {
    let isMounted = true;
    try { initLocalDatabase(); } catch (e) {}

    const boot = async () => {
      try {
        const storedUser = (await AsyncStorage.getItem('@active_username')) || '';
        const token = await AsyncStorage.getItem('@ghost_token');
        setAuthToken(token);
        
        const me = storedUser.trim().toLowerCase();
        setIsPremium(await AsyncStorage.getItem('@is_premium') === 'true');

        if (!isMounted) return;
        setActiveUser(me);
        activeUserRef.current = me;

        const unreadKey = `@unread_${me}_${targetUser}`;
        await AsyncStorage.setItem(unreadKey, '0');

        if (!targetUser || !me) {
          setIsConnecting(false);
          setCryptoState('error');
          return;
        }

        try { await ensureKeysPublished(); } catch (e) {}

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
        connect(me, token);
      } catch (globalError) {
        setIsConnecting(false);
      }
    };
    boot();
    return () => {
      isMounted = false;
      if (clientRef.current) { clientRef.current.deactivate(); clientRef.current = null; }
    };
  }, [targetUser]);

  const fetchTargetProfile = async () => {
    try {
      const res = await apiClient.get(`/v1/p2p/profile/${targetUser}`);
      const rawPic = res.avatarUrl || res.profilePictureUrl || res.data?.avatarUrl || res.data?.profilePictureUrl;
      setTargetAvatar(resolveAvatarUrl(rawPic));
    } catch { setTargetAvatar(null); }
  };

  const connect = async (me: string, token: string | null) => {
    setIsConnecting(true);
    if (clientRef.current) { clientRef.current.deactivate(); clientRef.current = null; }
    if (!token) { setIsConnecting(false); return; }

    const roomId = [me, targetUser].sort().join('_');
    roomIdRef.current = roomId;
    loadLocalHistory(roomId);

    const client = new Client({
      webSocketFactory: () => {
        const ws = new WebSocket(P2P_WS_URL);
        const originalSend = ws.send.bind(ws);
        ws.send = (data: any) => {
          if (typeof data === 'string') {
            const encoder = new TextEncoder();
            const uint8Array = encoder.encode(data);
            originalSend(uint8Array.buffer);
          } else if (data && data.buffer instanceof ArrayBuffer) {
            originalSend(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
          } else {
            originalSend(data);
          }
        };
        return ws;
      },
      connectHeaders: { Authorization: `Bearer ${token}` },
      debug: () => {},
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      reconnectDelay: 5000,

      onConnect: () => {
        setIsLinkActive(true);
        setIsConnecting(false);

        const pending = pendingOutboundRef.current;
        if (pending.length > 0) {
          pending.forEach(payload => {
            client.publish({ destination: '/app/shadow/send', body: JSON.stringify(payload) });
          });
          pendingOutboundRef.current = [];
        }

        client.subscribe(`/topic/shadow-${roomId}`, async (frame) => {
          let payload: any;
          try { payload = JSON.parse(frame.body); } catch { return; }

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

            const newMsg = {
              msgId: payload.msgId,
              sender_username: sender || targetUser,
              content: plaintext || 'Message could not be verified',
              timestamp: new Date().toISOString(),
              undecryptable: plaintext === null,
            };

            if (plaintext !== null) {
              try { saveLocalMessage(payload.roomId || roomId, sender || targetUser, plaintext, null, null, activeUserRef.current); } 
              catch (e) { }
            }

            const updated = [...prev, newMsg];
            return updated.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          });
          scrollToEnd();
        });
      },
      onDisconnect: () => { setIsLinkActive(false); setIsConnecting(true); },
      onWebSocketClose: () => { setIsLinkActive(false); setIsConnecting(true); },
      onStompError: () => { setIsLinkActive(false); setIsConnecting(false); },
    });

    clientRef.current = client;
    client.activate();
  };

  const loadLocalHistory = (roomId: string) => {
    try {
      const history = getLocalMessages(roomId);
      const sortedHistory = Array.isArray(history) 
        ? history.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        : [];
      setMessages(sortedHistory);
      scrollToEnd(false);
    } catch (e) { setMessages([]); }
  };

  const dispatchEncryptedPayload = async (textPayload: string) => {
    setSending(true);
    const roomId = roomIdRef.current;
    const clientMsgId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    try {
      const envelope = await encryptForPeer(textPayload, targetUser);
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

      saveLocalMessage(roomId, activeUserRef.current, textPayload, null, null, targetUser);
      setMessages((prev) => [...prev, {
        msgId: clientMsgId,
        sender_username: activeUserRef.current,
        content: textPayload,
        timestamp: new Date().toISOString(),
      }]);
      
      setChatInput('');
      scrollToEnd();

      const client = clientRef.current;
      if (client?.connected) {
        client.publish({ destination: '/app/shadow/send', body: JSON.stringify(payloadObj) });
      } else {
        pendingOutboundRef.current.push(payloadObj);
      }
    } catch (e: any) {
      if (e instanceof KeyChangedError) setCryptoState('key-changed');
      else if (e instanceof NoKeyError) setCryptoState('peer-has-no-key');
      else Alert.alert('Could not send', e?.message || 'Encryption failed.');
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    const text = chatInput.trim();
    if (!text || !activeUserRef.current || sending || isBlocked) return;
    if (cryptoState !== 'ready') return;
    dispatchEncryptedPayload(text);
  };

  const handleAttachment = async () => {
    if (isBlocked) return;
    if (Platform.OS === 'web') {
      launchImagePicker();
      return;
    }

    Alert.alert(
      'Attach File',
      isPremium ? 'Select a photo or file to send.' : 'Free users can send compressed photos. Upgrade to Premium for uncompressed documents.',
      [
        { text: 'Send Photo', onPress: launchImagePicker },
        { text: 'Send Document (Premium)', onPress: () => {
            if(!isPremium) Alert.alert('Premium Required', 'Upgrade to send raw documents.');
        }},
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const launchImagePicker = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: isPremium ? 0.5 : 0.1, 
      base64: true, 
    });
    
    if (!result.canceled && result.assets[0].base64) {
      try {
        const base64String = `data:image/jpeg;base64,${result.assets[0].base64}`;
        if (base64String.length > 700000) {
          Alert.alert("Image Too Large", "Please pick a smaller image or crop it before sending.");
          return;
        }
        await dispatchEncryptedPayload(`[B64_IMG]${base64String}`);
      } catch (e: any) {
        Alert.alert("Send Failed", "Could not send image.");
      }
    }
  };

  const handleMenuOptions = () => {
    Alert.alert(
      'Chat Options',
      `Options for @${targetUser}`,
      [
        { text: 'Clear Local History', style: 'destructive', onPress: () => {
            setMessages([]); 
            Alert.alert('Cleared', 'Local history cleared.');
        }},
        { text: isBlocked ? 'Unblock User' : 'Block User', style: 'destructive', onPress: () => setIsBlocked(!isBlocked) },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  const handleAcceptKeyChange = async () => {
    try { await acceptPeerKeyChange(targetUser); setCryptoState('ready'); } 
    catch { setCryptoState('error'); }
  };

  const showSafetyNumber = async () => {
    const num = await safetyNumber(targetUser);
    Alert.alert('Safety number', num ? `${num}\n\nCompare this with @${targetUser} in person.` : 'Not available yet.');
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) throw new Error();
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  };

  const canType = cryptoState === 'ready' && !isBlocked;

  const renderBanner = () => {
    if (isBlocked) {
      return (
        <View style={[styles.banner, styles.bannerDanger]}>
          <Feather name="slash" size={12} color="#FF3B30" />
          <Text style={[styles.bannerText, { color: '#FF3B30' }]}> User is blocked. Messaging disabled.</Text>
        </View>
      );
    }
    if (cryptoState === 'ready') {
      return (
        <TouchableOpacity style={[styles.banner, styles.bannerOk]} onPress={showSafetyNumber}>
          <Feather name="lock" size={12} color="#00C851" />
          <Text style={[styles.bannerText, { color: '#00C851' }]}> End-to-end encrypted. Tap to verify.</Text>
        </TouchableOpacity>
      );
    }
    if (cryptoState === 'key-changed') {
      return (
        <TouchableOpacity style={[styles.banner, styles.bannerDanger]} onPress={handleAcceptKeyChange}>
          <Feather name="alert-triangle" size={12} color="#FF3B30" />
          <Text style={[styles.bannerText, { color: '#FF3B30' }]}> @{targetUser}'s key changed. Tap to trust.</Text>
        </TouchableOpacity>
      );
    }
    if (cryptoState === 'peer-has-no-key') {
      return (
        <View style={[styles.banner, styles.bannerWarn]}>
          <Feather name="clock" size={12} color="#D1B000" />
          <Text style={[styles.bannerText, { color: '#D1B000' }]}> Waiting for @{targetUser} to publish keys.</Text>
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
        <Text style={[styles.bannerText, { color: '#FF3B30' }]}> Encryption unavailable. Cannot send.</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('MainTabs'))}>
            <Feather name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.activeHeader}>
            <View style={styles.avatarPlaceholder}>
              {targetAvatar ? (
                <Image source={getSecureImageSource(targetAvatar)} style={{ width: '100%', height: '100%' }} />
              ) : (
                <Text style={styles.avatarText}>{targetUser ? targetUser[0]?.toUpperCase() : '?'}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTextActive}>@{targetUser || 'unknown'}</Text>
              <Text style={styles.statusText}>
                {isConnecting ? 'connecting...' : isLinkActive ? 'connected' : 'offline'}
              </Text>
            </View>
          </View>

          <TouchableOpacity onPress={handleMenuOptions} style={styles.menuBtn}>
            <Feather name="more-vertical" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView ref={scrollViewRef} style={styles.chatArea} contentContainerStyle={{ paddingBottom: 20 }}>
          {renderBanner()}

          {messages.map((msg, idx) => {
            const msgSender = (msg.sender_username || '').trim().toLowerCase();
            const isMe = msgSender === activeUser;

            const isBase64Image = msg.content && msg.content.startsWith('[B64_IMG]');
            const base64DataUri = isBase64Image ? msg.content.replace('[B64_IMG]', '') : '';

            return (
              <View key={msg.msgId || idx} style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.theirBubbleWrapper]}>
                
                {!isMe && (
                  <View style={styles.chatAvatarContainer}>
                    {targetAvatar ? (
                      <Image source={getSecureImageSource(targetAvatar)} style={styles.chatAvatar} />
                    ) : (
                      <View style={styles.chatAvatarFallback}>
                        <Text style={styles.chatAvatarText}>{targetUser[0]?.toUpperCase()}</Text>
                      </View>
                    )}
                  </View>
                )}

                <View style={[
                  styles.bubble,
                  isMe ? styles.myBubble : styles.theirBubble,
                  msg.undecryptable ? styles.badBubble : null,
                  isBase64Image ? { paddingHorizontal: 4, paddingVertical: 4 } : null
                ]}>
                  {isBase64Image ? (
                    <Image source={{ uri: base64DataUri }} style={styles.chatImage} resizeMode="cover" />
                  ) : (
                    <Text style={[styles.bubbleText, { color: '#E9EDEF' }, msg.undecryptable ? styles.badBubbleText : null]}>
                      {msg.content}
                    </Text>
                  )}

                  <Text style={[
                    styles.timestamp, 
                    isMe ? styles.myTimestamp : styles.theirTimestamp,
                    isBase64Image ? styles.mediaTimestamp : null
                  ]}>
                    {formatTime(msg.timestamp)}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.inputRow, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TouchableOpacity style={styles.attachBtn} onPress={handleAttachment}>
            <Feather name="paperclip" size={20} color="#8E95A5" />
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={chatInput}
            onChangeText={setChatInput}
            placeholder={isBlocked ? 'User Blocked' : cryptoState !== 'ready' ? 'Encryption syncing...' : 'Message...'}
            placeholderTextColor="#666666"
            editable={canType}
            multiline
          />

          <TouchableOpacity
            style={[styles.sendBtn, (!chatInput.trim() || !canType) && { backgroundColor: '#1A1A1A' }]}
            onPress={handleSend}
            disabled={!canType || !chatInput.trim() || sending}
          >
            <Feather name="send" size={18} color={chatInput.trim() && canType ? '#FFFFFF' : '#666666'} style={{ marginLeft: -2 }} />
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
  activeHeader: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  avatarText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  headerTextActive: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  statusText: { fontSize: 11, color: '#00C851', fontWeight: '600' },
  menuBtn: { padding: 4 },

  chatArea: { flex: 1, padding: 16 },
  banner: { flexDirection: 'row', padding: 10, borderRadius: 8, marginBottom: 20, alignItems: 'center', justifyContent: 'center' },
  bannerOk: { backgroundColor: 'rgba(0, 200, 81, 0.1)' },
  bannerWarn: { backgroundColor: 'rgba(209, 176, 0, 0.1)' },
  bannerDanger: { backgroundColor: 'rgba(255, 59, 48, 0.1)' },
  bannerText: { fontSize: 11, textAlign: 'center', fontWeight: '600', flexShrink: 1 },
  
  bubbleWrapper: { marginBottom: 16, flexDirection: 'row', width: '100%', alignItems: 'flex-end' },
  myBubbleWrapper: { justifyContent: 'flex-end' },
  theirBubbleWrapper: { justifyContent: 'flex-start' },
  
  chatAvatarContainer: { marginRight: 8, marginBottom: 4 },
  chatAvatar: { width: 26, height: 26, borderRadius: 13 },
  chatAvatarFallback: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center' },
  chatAvatarText: { color: '#8E95A5', fontSize: 12, fontWeight: 'bold' },

  bubble: { paddingHorizontal: 14, paddingVertical: 10, maxWidth: '75%' },
  myBubble: { backgroundColor: '#333333', borderTopLeftRadius: 16, borderTopRightRadius: 4, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  theirBubble: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 4, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 16 },
  badBubble: { backgroundColor: '#2A1A1A', borderWidth: 1, borderColor: '#5C2A2A' },
  
  bubbleText: { fontSize: 15, lineHeight: 20 },
  badBubbleText: { color: '#FF8A80', fontStyle: 'italic' },
  
  chatImage: { width: 220, height: 220, borderRadius: 12, backgroundColor: '#262626' },
  mediaTimestamp: { position: 'absolute', bottom: 10, right: 12, color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },

  timestamp: { fontSize: 10, alignSelf: 'flex-end', marginTop: 4, marginLeft: 12 },
  myTimestamp: { color: 'rgba(255,255,255,0.6)' },
  theirTimestamp: { color: 'rgba(255,255,255,0.5)' },
  
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, backgroundColor: '#1A1A1A' },
  attachBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  input: { flex: 1, backgroundColor: '#262626', borderRadius: 24, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, color: '#FFFFFF', fontSize: 15, maxHeight: 100, minHeight: 44 },
  sendBtn: { backgroundColor: '#333333', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
});