import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform, Image, Alert, KeyboardAvoidingView, DeviceEventEmitter, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { apiClient, API_ROUTES, BASE_URL } from '../services/api';
import { useNetwork } from '../services/GlobalNetworkManager'; 
import { ensureKeysPublished, getPeerPublicKey, acceptPeerKeyChange, KeyChangedError, NoKeyError } from '../services/CryptoVault';
import { initLocalDatabase, saveLocalMessage, getLocalMessages, markRoomAsRead, clearLocalMessages, blockLocalUser, getUnreadIncomingIds, setMessageStatus } from '../services/LocalDB';

export let currentActiveChat = '';

interface MessageItem {
  msgId?: string;
  sender_username: string;
  content: string;
  timestamp: string;
  undecryptable?: boolean;
  status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'; 
}

type CryptoState = 'checking' | 'ready' | 'peer-has-no-key' | 'key-changed' | 'error';

export default function GossipsChatScreen({ route, navigation }: any) {
  const targetUser = (route.params?.targetUser || '').replace(/^@/, '').trim().toLowerCase();
  const insets = useSafeAreaInsets();
  const { kickOutbox, resync, sendReceipt } = useNetwork(); 

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
    if (Platform.OS === 'android') {
      const showSubscription = Keyboard.addListener('keyboardDidShow', (e) => {
        setKeyboardHeight(e.endCoordinates.height);
        scrollToEnd(true);
      });
      const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
        setKeyboardHeight(0);
      });
      return () => {
        showSubscription.remove();
        hideSubscription.remove();
      };
    }
  }, []);

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

        apiClient.get(API_ROUTES.SOCIAL.USER_PROFILE(targetUser)).then(res => {
            if (isMounted && (res?.avatarUrl || res?.profilePictureUrl)) {
                const rawAvatar = res.avatarUrl || res.profilePictureUrl;
                setTargetAvatar(rawAvatar.startsWith('http') ? rawAvatar : `${BASE_URL.replace(/\/$/, '')}${rawAvatar.startsWith('/') ? rawAvatar : `/${rawAvatar}`}`);
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
      }
    });

    return () => {
      isMounted = false;
      currentActiveChat = ''; 
      dbSub.remove();
    };
  }, [targetUser]);

  // 🟢 FIX: Relies purely on LocalDB and emits "Read" receipts automatically
  const loadLocalHistory = (roomId: string) => {
    try {
      const unread = getUnreadIncomingIds(roomId, activeUserRef.current);
      if (unread.length) sendReceipt(targetUser, unread, 'read'); 
      markRoomAsRead(roomId);
      setMessages(getLocalMessages(roomId) as MessageItem[]);
      scrollToEnd(false);
    } catch (e) {
      setMessages([]);
    }
  };

  // 🟢 FIX: Uses Outbox pattern rather than manual optimistic merging
  const handleSend = () => {
    const text = chatInput.trim();
    if (!text) return;
    if (cryptoState !== 'ready') { 
      Alert.alert('Cannot encrypt', 'Encryption keys are not ready for this conversation.'); 
      return; 
    }
    
    setChatInput('');
    const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    saveLocalMessage(roomIdRef.current, activeUserRef.current, text, null, null, targetUser, msgId, new Date().toISOString(), false, true, 'pending');
    kickOutbox(); 
  };

  const handleChatOptions = () => {
    Alert.alert('Chat Options', `Manage conversation with @${targetUser}`, [
      { text: 'Clear Chat', onPress: () => {
          clearLocalMessages(roomIdRef.current, true, targetUser, activeUserRef.current);
          setMessages([]);
      }},
      { text: 'Delete Chat', style: 'destructive', onPress: () => {
          clearLocalMessages(roomIdRef.current, false);
          navigation.navigate('MainTabs', { screen: 'Gossips' });
      }},
      { text: 'Block User', style: 'destructive', onPress: () => {
          blockLocalUser(targetUser);
          navigation.navigate('MainTabs', { screen: 'Gossips' });
      }},
      { text: 'Report User', onPress: () => {
          apiClient.post('/v1/social/moderation/report', { targetUser, type: 'USER_REPORT' }).catch(()=>{});
          Alert.alert('Reported', 'User has been reported for review.');
      }},
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const chatContent = (
    <>
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
              <TouchableOpacity 
                key={item.msgId || i.toString()} 
                style={[styles.row, isMe ? styles.rowMine : styles.rowTheirs]}
                activeOpacity={1}
                // 🟢 FIX: Allow manual retry of failed outbox messages
                onLongPress={() => {
                  if (isMe && item.status === 'failed' && item.msgId) {
                    setMessageStatus(item.msgId, 'pending');
                    kickOutbox();
                  }
                }}
              >
                <View style={[styles.bubble, isMe ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={styles.bubbleText}>{item.content}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 3 }}>
                    <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
                    {/* 🟢 FIX: WhatsApp Style Message Ticks */}
                    {isMe && (
                      <Text style={{ fontSize: 10, marginLeft: 4, color: item.status === 'read' ? '#34B7F1' : item.status === 'failed' ? '#FF4444' : 'rgba(255,255,255,0.4)' }}>
                        {item.status === 'pending' ? '🕓' : item.status === 'sent' ? '✓' : (item.status === 'delivered' || item.status === 'read') ? '✓✓' : item.status === 'failed' ? '!' : ''}
                      </Text>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
      
      {/* 🟢 FIX: Key Change Banner to accept new security keys */}
      {cryptoState === 'key-changed' && (
        <TouchableOpacity onPress={async () => { await acceptPeerKeyChange(targetUser); setCryptoState('ready'); resync(); }}
          style={{ padding: 10, backgroundColor: '#332701' }}>
          <Text style={{ color: '#FBBF24', textAlign: 'center' }}>@{targetUser}'s security code changed. Tap to accept.</Text>
        </TouchableOpacity>
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput style={styles.input} value={chatInput} onChangeText={setChatInput} placeholder={`Message @${targetUser}…`} placeholderTextColor="#666666" multiline />
        <TouchableOpacity style={[styles.sendBtn, !chatInput.trim() && styles.sendBtnOff]} onPress={handleSend} disabled={!chatInput.trim()}>
          <Feather name="send" size={18} color={chatInput.trim() ? '#FFFFFF' : '#666666'} />
        </TouchableOpacity>
      </View>
    </>
  );

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
        <TouchableOpacity onPress={handleChatOptions} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <Feather name="more-vertical" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {chatContent}
        </KeyboardAvoidingView>
      ) : (
        <View style={{ flex: 1, paddingBottom: keyboardHeight }}>
          {chatContent}
        </View>
      )}
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