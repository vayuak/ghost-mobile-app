import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform, Image, Alert, KeyboardAvoidingView, DeviceEventEmitter, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { apiClient, API_ROUTES, BASE_URL } from '../services/api';
import { useNetwork } from '../services/GlobalNetworkManager'; 
import { ensureKeysPublished, getPeerPublicKey, acceptPeerKeyChange, KeyChangedError, NoKeyError } from '../services/CryptoVault';
import { initLocalDatabase, saveLocalMessage, getLocalMessages, markRoomAsRead, clearLocalMessages, blockLocalUser, getUnreadIncomingIds, setMessageStatus } from '../services/LocalDB';
import { useTheme } from '../context/ThemeContext'; 

export let currentActiveChat = '';
interface MessageItem { msgId?: string; sender_username: string; content: string; timestamp: string; undecryptable?: boolean; status?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'; }
type CryptoState = 'checking' | 'ready' | 'peer-has-no-key' | 'key-changed' | 'error';

export default function GossipsChatScreen({ route, navigation }: any) {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  
  const targetUser = (route.params?.targetUser || '').replace(/^@/, '').trim().toLowerCase();
  const insets = useSafeAreaInsets();
  const { kickOutbox, resync, sendReceipt } = useNetwork(); 

  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const textRef = useRef(''); // Added to synchronously catch predictive text
  const [activeUser, setActiveUser] = useState('');
  const [targetAvatar, setTargetAvatar] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null); 
  const [cryptoState, setCryptoState] = useState<CryptoState>('checking');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const roomIdRef = useRef<string>('');
  const activeUserRef = useRef<string>('');
  const scrollViewRef = useRef<ScrollView>(null);

  const scrollToEnd = (animated = true) => setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated }), 100);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const showSub = Keyboard.addListener('keyboardDidShow', (e) => { setKeyboardHeight(e.endCoordinates.height); scrollToEnd(true); });
      const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
      return () => { showSub.remove(); hideSub.remove(); };
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    currentActiveChat = targetUser; 
    AsyncStorage.getItem('@ghost_token').then(setAuthToken);

    const boot = async () => {
      try {
        initLocalDatabase();
        const stored = (await AsyncStorage.getItem('@active_username')) || '';
        const me = stored.trim().toLowerCase();
        if (!isMounted) return;
        setActiveUser(me); activeUserRef.current = me; roomIdRef.current = [me, targetUser].sort().join('_');
        loadLocalHistory(roomIdRef.current);

        apiClient.get(API_ROUTES.USERS.PROFILE(targetUser)).then(res => {
            const rawAvatar = res?.profile?.avatarUrl || res?.profile?.profilePictureUrl || res?.avatarUrl;
            if (isMounted && rawAvatar) setTargetAvatar(rawAvatar.startsWith('http') ? rawAvatar : `${BASE_URL.replace(/\/$/, '')}${rawAvatar.startsWith('/') ? rawAvatar : `/${rawAvatar}`}`);
        }).catch(() => {});

        try { await ensureKeysPublished(); } catch (e: any) { }
        if (!isMounted) return;
        try { await getPeerPublicKey(targetUser); setCryptoState('ready'); } catch (e: any) {
          if (!isMounted) return;
          if (e instanceof KeyChangedError) setCryptoState('key-changed');
          else if (e instanceof NoKeyError) setCryptoState('peer-has-no-key');
          else setCryptoState('error'); 
        }
      } catch (e: any) { }
    };

    boot();
    const dbSub = DeviceEventEmitter.addListener('db_chats_updated', () => { if (roomIdRef.current) loadLocalHistory(roomIdRef.current); });
    return () => { isMounted = false; currentActiveChat = ''; dbSub.remove(); };
  }, [targetUser]);

  const loadLocalHistory = (roomId: string) => {
    try {
      const unread = getUnreadIncomingIds(roomId, activeUserRef.current);
      if (unread.length) sendReceipt(targetUser, unread, 'read'); 
      markRoomAsRead(roomId);
      setMessages(getLocalMessages(roomId) as MessageItem[]);
      scrollToEnd(false);
    } catch (e) { setMessages([]); }
  };

  const handleSend = () => {
    const text = textRef.current;
    if (!text || text.length === 0) return;
    if (cryptoState !== 'ready') return Alert.alert('Cannot encrypt', 'Encryption keys are not ready.'); 
    
    setChatInput('');
    textRef.current = '';
    
    const msgId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    saveLocalMessage(roomIdRef.current, activeUserRef.current, text, null, null, targetUser, msgId, new Date().toISOString(), false, true, 'pending');
    kickOutbox(); 
  };

  const handleChatOptions = () => {
    Alert.alert('Chat Options', `Manage conversation with @${targetUser}`, [
        { text: 'Clear Chat', onPress: () => { clearLocalMessages(roomIdRef.current, true, targetUser, activeUserRef.current); setMessages([]); }},
        { text: 'Report User', onPress: () => { apiClient.post(API_ROUTES.CAMPFIRE.REPORT(targetUser)).catch(()=>{}); Alert.alert('Reported', 'User reported.'); }},
        { text: 'Block User', style: 'destructive', onPress: () => { blockLocalUser(targetUser); navigation.navigate('MainTabs', { screen: 'Gossips' }); }},
        { text: 'Cancel', style: 'cancel' }
      ], { cancelable: true }
    );
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const chatContent = (
    <>
      <ScrollView ref={scrollViewRef} style={styles.scrollArea} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 }} onContentSizeChange={() => scrollToEnd(false)}>
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="message-square" size={40} color={colors.border} />
            <Text style={styles.emptyText}>No messages yet</Text>
          </View>
        ) : (
          messages.map((item, i) => {
            const isMe = (item.sender_username || '').trim().toLowerCase() === activeUser;
            return (
              <TouchableOpacity 
                key={item.msgId || i.toString()} style={[styles.row, isMe ? styles.rowMine : styles.rowTheirs]} activeOpacity={1}
                onLongPress={() => { if (isMe && item.status === 'failed' && item.msgId) { setMessageStatus(item.msgId, 'pending'); kickOutbox(); }}}
              >
                <View style={[styles.bubble, isMe ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={[styles.bubbleText, isMe && { color: '#FFF' }]}>{item.content}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 3 }}>
                    <Text style={[styles.time, isMe && { color: 'rgba(255,255,255,0.7)' }]}>{formatTime(item.timestamp)}</Text>
                    {isMe && (
                      <Text style={{ fontSize: 10, marginLeft: 4, color: item.status === 'read' ? '#34B7F1' : item.status === 'failed' ? colors.danger : 'rgba(255,255,255,0.7)' }}>
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
      
      {cryptoState === 'key-changed' && (
        <TouchableOpacity onPress={async () => { await acceptPeerKeyChange(targetUser); setCryptoState('ready'); resync(); }} style={{ padding: 10, backgroundColor: colors.warning }}>
          <Text style={{ color: '#000', textAlign: 'center', fontWeight: 'bold' }}>@{targetUser}'s security code changed. Tap to accept.</Text>
        </TouchableOpacity>
      )}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={styles.inputContainer}>
          <TextInput 
            style={styles.input} 
            value={chatInput} 
            onChangeText={(val) => { textRef.current = val; setChatInput(val); }} 
            placeholder={`Message...`} 
            placeholderTextColor={colors.textMuted} 
            multiline 
            blurOnSubmit={false}
          />
          {chatInput.length > 0 && (
            <TouchableOpacity style={styles.sendIcon} onPressIn={handleSend}>
              <Feather name="send" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Feather name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.identity}>
            <TouchableOpacity style={styles.avatar} onPress={() => navigation.navigate('PublicProfile', { targetUser })}>
              {targetAvatar ? <Image source={{ uri: targetAvatar, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.avatarImg} /> : <Text style={styles.avatarLetter}>{targetUser ? targetUser[0]?.toUpperCase() : '?'}</Text>}
            </TouchableOpacity>
            <View style={{ flex: 1 }}><Text style={styles.peerName} numberOfLines={1}>@{targetUser || 'unknown'}</Text></View>
          </View>
        </View>
        <TouchableOpacity onPress={handleChatOptions} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="more-vertical" size={20} color={colors.text} /></TouchableOpacity>
      </View>
      {Platform.OS === 'ios' ? <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">{chatContent}</KeyboardAvoidingView> : <View style={{ flex: 1, paddingBottom: keyboardHeight }}>{chatContent}</View>}
    </View>
  );
}

const getStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 10, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn: { marginRight: 14 },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarLetter: { color: colors.text, fontWeight: 'bold', fontSize: 15 },
  peerName: { fontSize: 16, fontWeight: '700', color: colors.text },
  composer: { backgroundColor: colors.background, paddingHorizontal: 12, paddingTop: 8 },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', backgroundColor: colors.surface, borderRadius: 24, paddingHorizontal: 16, paddingVertical: 8, minHeight: 48, maxHeight: 120 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingTop: 6, paddingBottom: 6 },
  sendIcon: { marginLeft: 12, marginBottom: 4, justifyContent: 'center', alignItems: 'center' },
  scrollArea: { flex: 1 },
  row: { marginBottom: 12, flexDirection: 'row', width: '100%' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, maxWidth: '78%' },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20, color: colors.text },
  time: { fontSize: 10, color: colors.textMuted },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyText: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 14 }
});