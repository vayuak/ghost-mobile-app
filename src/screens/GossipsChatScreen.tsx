import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Platform, Image, Alert, ActivityIndicator, KeyboardAvoidingView, DeviceEventEmitter, Keyboard
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker'; 
import { apiClient, API_ROUTES, BASE_URL } from '../services/api';
import { getAvatarUrl, peekAvatarUrl } from '../services/ProfileCache'; 
import { useNetwork } from '../services/GlobalNetworkManager'; 
import {
  ensureKeysPublished, encryptForPeer, getPeerPublicKey,
  acceptPeerKeyChange, safetyNumber, KeyChangedError, NoKeyError,
} from '../services/CryptoVault';
import {
  initLocalDatabase, saveLocalMessage, getLocalMessages, markRoomAsRead, clearLocalMessages
} from '../services/LocalDB';

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

        if (!targetUser || !me) {
          setCryptoState('error');
          setLastError('Missing active username or target user.');
          return;
        }

        const roomId = [me, targetUser].sort().join('_');
        roomIdRef.current = roomId;
        
        loadLocalHistory(roomId);

        getAvatarUrl(targetUser).then((url) => { 
          if (isMounted && url) {
              // 🟢 NORMALIZED AVATAR URL
              const cleanUrl = url.startsWith('http') ? url : `${BASE_URL}${url.startsWith('/') ? url : `/${url}`}`;
              setTargetAvatar(cleanUrl); 
          }
        });

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

    const unsubAvatar = DeviceEventEmitter.addListener('avatar_cache_updated', (updatedUser) => {
        if (updatedUser === targetUser && isMounted) {
            const freshUrl = peekAvatarUrl(targetUser);
            if (freshUrl) {
                setTargetAvatar(freshUrl.startsWith('http') ? freshUrl : `${BASE_URL}${freshUrl.startsWith('/') ? freshUrl : `/${freshUrl}`}`);
            }
        }
    });

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
      unsubAvatar.remove();
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

    const optimisticMsg: MessageItem = {
      msgId: clientMsgId,
      sender_username: activeUserRef.current,
      content: text,
      timestamp: sentAt,
      status: 'sending'
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    scrollToEnd(true);

    processAndSend(text, clientMsgId, sentAt);
  };

  const handleAttachImage = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.granted === false) {
        Alert.alert("Permission Refused", "You must allow access to your photos to send an image.");
        return;
      }

      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.2, 
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets[0].base64) {
        const imagePayload = `DATA_IMAGE::data:image/jpeg;base64,${result.assets[0].base64}`;
        const clientMsgId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const sentAt = new Date().toISOString();
        
        setMessages((prev) => [...prev, { msgId: clientMsgId, sender_username: activeUserRef.current, content: imagePayload, timestamp: sentAt, status: 'sending' }]);
        scrollToEnd(true);

        processAndSend(imagePayload, clientMsgId, sentAt);
      }
    } catch (e) {
      Alert.alert("Gallery Error", "Could not process photo.");
    }
  };

  const handleAcceptKeyChange = async () => {
    try { await acceptPeerKeyChange(targetUser); setCryptoState('ready'); }
    catch { setCryptoState('error'); }
  };

  const showOptionsMenu = () => {
    Alert.alert(
      `Options for @${targetUser}`,
      'Select an action:',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Report User', 
          onPress: () => {
            Alert.alert('Report User', `Report @${targetUser} to moderators?`, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Report', style: 'destructive', onPress: async () => {
                  try {
                    await apiClient.post(API_ROUTES.CAMPFIRE.REPORT(targetUser));
                    Alert.alert('Reported', `@${targetUser} has been reported.`);
                  } catch (e: any) {
                    Alert.alert('Error', e?.message || 'Could not report user.');
                  }
                }
              }
            ]);
          } 
        },
        { 
          text: 'Manage Chat...', 
          onPress: () => {
            Alert.alert('Manage Chat', 'Block or clear messages:', [
              { text: 'Cancel', style: 'cancel' },
              { 
                text: 'Clear Chat', 
                onPress: () => {
                  Alert.alert('Clear Chat', 'Clear messages but keep thread in inbox?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Clear', style: 'destructive', onPress: () => {
                        clearLocalMessages(roomIdRef.current, true, targetUser, activeUserRef.current);
                    }}
                  ]);
                } 
              },
              { 
                text: 'Block User', 
                style: 'destructive',
                onPress: () => {
                  Alert.alert('Block User', `Block @${targetUser} permanently?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Block', style: 'destructive', onPress: () => {
                      import('../services/LocalDB').then(({ blockLocalUser }) => {
                         blockLocalUser(targetUser);
                      });
                      clearLocalMessages(roomIdRef.current, false); // Nuke chat entirely if blocked
                      navigation.goBack();
                    }}
                  ]);
                } 
              }
            ]);
          } 
        }
      ]
    );
  };
  
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const renderStatusStrip = () => {
    if (cryptoState === 'key-changed') {
      return (
        <TouchableOpacity style={[styles.strip, styles.stripDanger]} onPress={handleAcceptKeyChange}>
          <Feather name="alert-triangle" size={12} color="#FF3B30" />
          <Text style={[styles.stripText, { color: '#FF3B30' }]}>  @{targetUser}'s key changed. Tap to verify.</Text>
        </TouchableOpacity>
      );
    }
    if (cryptoState === 'peer-has-no-key') {
      return (
        <View style={[styles.strip, styles.stripWarn]}>
          <Feather name="clock" size={12} color="#D1B000" />
          <Text style={[styles.stripText, { color: '#D1B000' }]}>  Waiting for @{targetUser} to log in.</Text>
        </View>
      );
    }
    if (cryptoState === 'ready') {
      return (
        <View style={[styles.strip, styles.stripOk]}>
          <Feather name="lock" size={12} color="#A3A3A3" />
          <Text style={[styles.stripText, { color: '#A3A3A3' }]}>  End-to-end encrypted</Text>
        </View>
      );
    }
    return null;
  };

  const renderChatBody = () => (
    <>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollArea}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 }}
        onContentSizeChange={() => scrollToEnd(false)}
      >
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <Feather name="message-square" size={40} color="#262626" />
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySub}>Say something. Messages will appear here.</Text>
          </View>
        ) : (
          messages.map((item, i) => {
            if (item.sender_username === 'system') {
              return (
                <View key={item.msgId || i.toString()} style={styles.systemBubbleWrapper}>
                  <View style={styles.systemBubble}>
                    <Text style={styles.systemText}>{item.content}</Text>
                  </View>
                </View>
              );
            }

            const isMe = (item.sender_username || '').trim().toLowerCase() === activeUser;
            const isImage = item.content?.startsWith('DATA_IMAGE::');
            const displayContent = isImage ? item.content.replace('DATA_IMAGE::', '') : item.content;

            return (
              <View key={item.msgId || i.toString()} style={[styles.row, isMe ? styles.rowMine : styles.rowTheirs]}>
                <View style={[styles.bubble, isMe ? styles.bubbleMine : styles.bubbleTheirs, item.undecryptable && styles.bubbleBad]}>
                  {isImage ? (
                    <Image source={{ uri: displayContent }} style={styles.chatImage} resizeMode="cover" />
                  ) : (
                    <Text style={[styles.bubbleText, item.undecryptable && styles.bubbleBadText]}>{displayContent}</Text>
                  )}
                  
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 3 }}>
                    <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
                    {isMe && item.status === 'sending' && <Feather name="clock" size={10} color="rgba(255,255,255,0.4)" style={{ marginLeft: 4 }} />}
                    {isMe && item.status === 'failed' && <Feather name="alert-circle" size={10} color="#FF3B30" style={{ marginLeft: 4 }} />}
                    {isMe && !item.status && <Feather name="check" size={10} color="rgba(255,255,255,0.4)" style={{ marginLeft: 4 }} />}
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TouchableOpacity style={styles.attachBtn} onPress={handleAttachImage}>
          <Feather name="image" size={22} color="#A3A3A3" />
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={chatInput}
          onChangeText={setChatInput}
          placeholder={`Message @${targetUser}…`}
          placeholderTextColor="#666666"
          multiline
        />
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
        <TouchableOpacity style={styles.menuBtn} onPress={showOptionsMenu} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="more-vertical" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {renderStatusStrip()}
      {lastError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>SYSTEM NOTICE</Text>
          <Text style={styles.errorText}>{lastError}</Text>
        </View>
      )}

      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={insets.top + 60}>
          {renderChatBody()}
        </KeyboardAvoidingView>
      ) : (
        <View style={{ flex: 1, paddingBottom: keyboardHeight }}>
          {renderChatBody()}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 10, backgroundColor: '#0A0A0A', borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  backBtn: { marginRight: 14 },
  menuBtn: { marginLeft: 10 },
  identity: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarLetter: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
  peerName: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 10, backgroundColor: '#0A0A0A', borderTopWidth: 1, borderTopColor: '#1A1A1A' },
  attachBtn: { padding: 10, paddingBottom: 12, marginRight: 4 },
  input: { flex: 1, backgroundColor: '#1A1A1A', borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, color: '#FFFFFF', fontSize: 15, maxHeight: 110, minHeight: 44, borderWidth: 1, borderColor: '#262626' },
  sendBtn: { backgroundColor: '#333333', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  sendBtnOff: { backgroundColor: '#1A1A1A' },
  strip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 7, paddingHorizontal: 12, backgroundColor: '#111111', borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  stripOk: { backgroundColor: 'rgba(255,255,255,0.05)' },
  stripWarn: { backgroundColor: 'rgba(209,176,0,0.08)' },
  stripDanger: { backgroundColor: 'rgba(255,59,48,0.10)' },
  stripText: { fontSize: 10.5, fontWeight: '600', flexShrink: 1 },
  errorBox: { backgroundColor: 'rgba(255,59,48,0.08)', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#5C2A2A', paddingHorizontal: 16, paddingVertical: 8 },
  errorTitle: { color: '#FF8A80', fontSize: 9.5, fontWeight: '800', letterSpacing: 1, marginBottom: 3 },
  errorText: { color: '#FFB3AA', fontSize: 12 },
  scrollArea: { flex: 1 },
  row: { marginBottom: 10, flexDirection: 'row', width: '100%' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 16, maxWidth: '78%' },
  bubbleMine: { backgroundColor: '#262626', borderTopLeftRadius: 16, borderBottomLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 4, borderWidth: 1, borderColor: '#333333' },
  bubbleTheirs: { backgroundColor: '#121212', borderTopLeftRadius: 16, borderBottomRightRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#1F1F1F' },
  bubbleBad: { backgroundColor: '#2A1A1A', borderWidth: 1, borderColor: '#5C2A2A' },
  bubbleText: { fontSize: 15, lineHeight: 20, color: '#E9EDEF' },
  bubbleBadText: { color: '#FF8A80', fontStyle: 'italic' },
  time: { fontSize: 9.5, color: 'rgba(255,255,255,0.40)' },
  chatImage: { width: 220, height: 220, borderRadius: 8, marginBottom: 4 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', marginTop: 14 },
  emptySub: { color: '#666666', fontSize: 12.5, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  systemBubbleWrapper: { alignItems: 'center', marginVertical: 12 }, 
  systemBubble: { backgroundColor: '#1A1A1A', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#262626' },
  systemText: { color: '#8E95A5', fontSize: 11, fontWeight: '600', fontStyle: 'italic' },
});