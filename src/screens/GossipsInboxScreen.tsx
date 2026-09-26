import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform, Image, Alert, KeyboardAvoidingView, DeviceEventEmitter, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { apiClient, API_ROUTES, BASE_URL } from '../services/api';
import { useNetwork } from '../services/GlobalNetworkManager'; 
import { ensureKeysPublished, encryptForPeer, getPeerPublicKey, acceptPeerKeyChange, KeyChangedError, NoKeyError } from '../services/CryptoVault';
import { initLocalDatabase, saveLocalMessage, getLocalMessages, markRoomAsRead, clearLocalMessages } from '../services/LocalDB';

export let currentActiveChat = '';

interface MessageItem {
  msgId?: string;
  sender_username: string;
  content: string;
  timestamp: string;
  undecryptable?: boolean;
  status?: 'sending' | 'failed' | 'sent'; 
}

type CryptoState = 'checking' | 'ready' | 'peer-has-no-key' | 'key-changed' | 'error';

export default function GossipsChatScreen({ route, navigation }: any) {
  const targetUser = (route.params?.targetUser || '').trim().toLowerCase();
  const insets = useSafeAreaInsets();
  const { sendStompMessage } = useNetwork(); 

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeUser, setActiveUser] = useState('');
  const [targetAvatar, setTargetAvatar] = useState<string | null>(null);

  const [cryptoState, setCryptoState] = useState<CryptoState>('checking');
  const [lastError, setLastError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const roomIdRef = useRef<string>('');
  const activeUserRef = useRef<string>('');
  const scrollViewRef = useRef<ScrollView>(null);

  const scrollToEnd = (animated = true) => {
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated }), 100);
  };

  useEffect(() => {
    let isMounted = true;
    currentActiveChat = targetUser; 

    const boot = async () => {
      try {
        initLocalDatabase();
        const stored = (await AsyncStorage.getItem('@active_username')) || '';
        const me = stored.trim().toLowerCase();

        if (!isMounted) return;
        setActiveUser(me);
        activeUserRef.current = me;
        roomIdRef.current = [me, targetUser].sort().join('_');
        
        loadLocalHistory(roomIdRef.current);

        // 🟢 FIX: Directly fetch DP from backend
        apiClient.get(`/api/social/user/${targetUser}/profile`).then(res => {
            if (isMounted && res?.avatarUrl) {
                setTargetAvatar(res.avatarUrl.startsWith('http') ? res.avatarUrl : `${BASE_URL}${res.avatarUrl}`);
            }
        }).catch(() => {});

        try { await ensureKeysPublished(); } catch (e: any) { }
        if (!isMounted) return;

        try {
          await getPeerPublicKey(targetUser);
          setCryptoState('ready');
        } catch (e: any) {
          if (!isMounted) return;
          if (e instanceof KeyChangedError) setCryptoState('key-changed');
          else if (e instanceof NoKeyError) setCryptoState('peer-has-no-key');
          else { setCryptoState('error'); setLastError(`Encryption Key Error: ${e?.message}`); }
        }
      } catch (e: any) {
        setLastError(e?.message || 'Unknown startup error.');
      }
    };

    boot();

    const dbSub = DeviceEventEmitter.addListener('db_chats_updated', () => {
      if (roomIdRef.current) {
        loadLocalHistory(roomIdRef.current);
        scrollToEnd(true);
      }
    });

    return () => {
      isMounted = false;
      currentActiveChat = ''; 
      dbSub.remove();
    };
  }, [targetUser]);

  const loadLocalHistory = (roomId: string) => {
    try {
      markRoomAsRead(roomId); 
      const history = getLocalMessages(roomId);
      setMessages((current) => {
        const dbMsgs = Array.isArray(history) ? (history as MessageItem[]) : [];
        const pendingMsgs = current.filter(m => m.status === 'sending' || m.status === 'failed');
        const pendingNotSaved = pendingMsgs.filter(p => !dbMsgs.some(d => d.msgId === p.msgId));
        return [...dbMsgs, ...pendingNotSaved];
      });
      scrollToEnd(false);
    } catch (e: any) {
      setMessages([]);
    }
  };

  const processAndSend = async (plainTextPayload: string, clientMsgId: string, sentAt: string) => {
    const roomId = roomIdRef.current;
    try {
      const envelope = await encryptForPeer(plainTextPayload, targetUser);
      sendStompMessage('/app/shadow/send', {
        v: envelope.v,
        msgId: clientMsgId,
        roomId,
        senderUsername: activeUserRef.current,
        targetUsername: targetUser,
        sentAt,
        ephemeralPublicKey: envelope.senderPublicKey,
        ciphertext: envelope.ciphertext,
        iv: envelope.iv,
      });

      saveLocalMessage(roomId, activeUserRef.current, plainTextPayload, null, null, targetUser, clientMsgId, sentAt);
      markRoomAsRead(roomId);
    } catch (e: any) {
      if (e instanceof KeyChangedError) setCryptoState('key-changed');
      else if (e instanceof NoKeyError) setCryptoState('peer-has-no-key');
      setMessages((prev) => prev.map(m => m.msgId === clientMsgId ? { ...m, status: 'failed' } : m));
      Alert.alert('Could not send', e?.message || 'Encryption failed.');
    }
  };

  const handleSend = async () => {
    const text = chatInput.trim();
    if (!text) return;
    
    if (cryptoState !== 'ready') {
      Alert.alert('Cannot encrypt', 'Encryption keys are not ready for this conversation.');
      return;
    }

    setChatInput(''); 
    const clientMsgId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const sentAt = new Date().toISOString();

    const optimisticMsg: MessageItem = { msgId: clientMsgId, sender_username: activeUserRef.current, content: text, timestamp: sentAt, status: 'sending' };
    setMessages((prev) => [...prev, optimisticMsg]);
    scrollToEnd(true);

    processAndSend(text, clientMsgId, sentAt);
  };

  const handleAcceptKeyChange = async () => {
    try { await acceptPeerKeyChange(targetUser); setCryptoState('ready'); }
    catch { setCryptoState('error'); }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Feather name="arrow-left" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.identity}>
            <TouchableOpacity style={styles.avatar} onPress={() => navigation.navigate('PublicProfile', { targetUser })}>
              {targetAvatar ? <Image source={{ uri: targetAvatar }} style={styles.avatarImg} /> : <Text style={styles.avatarLetter}>{targetUser ? targetUser[0]?.toUpperCase() : '?'}</Text>}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.peerName} numberOfLines={1}>@{targetUser || 'unknown'}</Text>
            </View>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scrollViewRef} style={styles.scrollArea} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 }} onContentSizeChange={() => scrollToEnd(false)}>
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="message-square" size={40} color="#262626" />
              <Text style={styles.emptyText}>No messages yet</Text>
            </View>
          ) : (
            messages.map((item, i) => {
              const isMe = (item.sender_username || '').trim().toLowerCase() === activeUser;
              return (
                <View key={item.msgId || i.toString()} style={[styles.row, isMe ? styles.rowMine : styles.rowTheirs]}>
                  <View style={[styles.bubble, isMe ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={styles.bubbleText}>{item.content}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 3 }}>
                      <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
                      {isMe && item.status === 'sending' && <Feather name="clock" size={10} color="rgba(255,255,255,0.4)" style={{ marginLeft: 4 }} />}
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {/* 🟢 IMAGE ATTACH BUTTON COMPLETELY REMOVED */}
          <TextInput style={styles.input} value={chatInput} onChangeText={setChatInput} placeholder={`Message @${targetUser}…`} placeholderTextColor="#666666" multiline />
          <TouchableOpacity style={[styles.sendBtn, !chatInput.trim() && styles.sendBtnOff]} onPress={handleSend} disabled={!chatInput.trim()}>
            <Feather name="send" size={18} color={chatInput.trim() ? '#FFFFFF' : '#666666'} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 10, backgroundColor: '#0A0A0A', borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  backBtn: { marginRight: 14 },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarLetter: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  peerName: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 10, backgroundColor: '#0A0A0A', borderTopWidth: 1, borderTopColor: '#1A1A1A' },
  input: { flex: 1, backgroundColor: '#1A1A1A', borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, color: '#FFFFFF', fontSize: 15, maxHeight: 110, minHeight: 44, borderWidth: 1, borderColor: '#262626' },
  sendBtn: { backgroundColor: '#333333', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  sendBtnOff: { backgroundColor: '#1A1A1A' },
  scrollArea: { flex: 1 },
  row: { marginBottom: 10, flexDirection: 'row', width: '100%' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16, maxWidth: '78%' },
  bubbleMine: { backgroundColor: '#262626', borderTopLeftRadius: 16, borderBottomLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 4, borderWidth: 1, borderColor: '#333333' },
  bubbleTheirs: { backgroundColor: '#121212', borderTopLeftRadius: 16, borderBottomRightRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#1F1F1F' },
  bubbleText: { fontSize: 15, lineHeight: 20, color: '#E9EDEF' },
  time: { fontSize: 9.5, color: 'rgba(255,255,255,0.40)' },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', marginTop: 14 }
});