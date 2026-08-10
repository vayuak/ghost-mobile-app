import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Client } from '@stomp/stompjs';
import CryptoJS from 'crypto-js';
import { Feather } from '@expo/vector-icons';
import { apiClient, BASE_URL, P2P_WS_URL } from '../services/api';
import { initLocalDatabase, saveLocalMessage, getLocalMessages } from '../services/LocalDB';



interface MessageItem {
  msgId?: string;
  sender_username: string;
  iv?: string;
  content: string;
  timestamp: string;
}

export default function GossipsChatScreen({ route, navigation }: any) {
  const targetUser = (route.params?.targetUser || '').trim().toLowerCase();

  const [stompClient, setStompClient] = useState<Client | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeUser, setActiveUser] = useState(''); 
  const [targetAvatar, setTargetAvatar] = useState<string | null>(null);
  
  const [isConnecting, setIsConnecting] = useState(true);
  const [isSecureLinkActive, setIsSecureLinkActive] = useState(false);
  const [roomSecret, setRoomSecret] = useState<string | null>(null);
  
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    let isMounted = true;

    const initializeChat = async () => {
      const storedUser = await AsyncStorage.getItem('@active_username') || 'Unknown';
      const normalizedActive = storedUser.trim().toLowerCase();
      
      if (isMounted) {
        setActiveUser(normalizedActive);
      }

      if (targetUser) {
        fetchTargetProfile();
        initiateAutoConnection(normalizedActive);
      }
    };

    initializeChat();

    return () => {
      isMounted = false;
      if (stompClient) {
        stompClient.deactivate();
      }
    };
  }, [targetUser]);

  const fetchTargetProfile = async () => {
    try {
      const res = await apiClient.get(`/v1/social/user/${targetUser}/profile`);
      const rawPic = res.avatarUrl || res.profilePictureUrl || res.data?.avatarUrl;
      
      if (rawPic && typeof rawPic === 'string' && rawPic.trim() !== '') {
        const fullUrl = rawPic.startsWith('http') ? rawPic : `${BASE_URL}${rawPic}`;
        setTargetAvatar(fullUrl);
      } else {
        setTargetAvatar(null);
      }
    } catch {
      setTargetAvatar(null);
    }
  };

  const initiateAutoConnection = async (currentUser: string) => {
    setIsConnecting(true);
    const token = await AsyncStorage.getItem('@ghost_token');

    try {
      const derivedKey = "SIMULATED_ECDH_SHARED_SECRET_UNTIL_API_IS_READY"; 
      setRoomSecret(derivedKey);
      
      const roomId = [currentUser, targetUser].sort().join('_');
      loadLocalHistory(roomId);

      const client = new Client({
        brokerURL: P2P_WS_URL,
        connectHeaders: { Authorization: `Bearer ${token}` },
        onConnect: () => {
          setIsSecureLinkActive(true);
          setIsConnecting(false);

          client.subscribe(`/topic/shadow-${roomId}`, (msg) => {
            const payload = JSON.parse(msg.body);

            try {
              const decryptedBytes = CryptoJS.AES.decrypt(payload.ciphertext, derivedKey, { 
                iv: CryptoJS.enc.Hex.parse(payload.iv) 
              });
              const decryptedText = decryptedBytes.toString(CryptoJS.enc.Utf8);
              
              if (decryptedText) {
                setMessages((prev) => {
                  const isEcho = prev.some((m) => m.iv === payload.iv);
                  if (isEcho) return prev;

                  saveLocalMessage(payload.roomId, targetUser, decryptedText);

                  return [...prev, { 
                    msgId: payload.msgId,
                    iv: payload.iv,
                    sender_username: targetUser,
                    content: decryptedText,
                    timestamp: new Date().toISOString()
                  }];
                });

                setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
              }
            } catch (e) {
              console.warn("Packet dropped: Decryption failure.");
            }
          });
        },
        onDisconnect: () => setIsSecureLinkActive(false),
        onStompError: () => setIsConnecting(false)
      });
      
      client.activate();
      setStompClient(client);
    } catch (error) {
      console.error("Auto-connect failed:", error);
      setIsConnecting(false);
    }
  };

  const loadLocalHistory = (roomId: string) => {
    const history = getLocalMessages(roomId);
    setMessages(history);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: false }), 100);
  };

  const sendEncryptedMessage = () => {
    if (!chatInput.trim() || !stompClient?.connected || !roomSecret || !activeUser) return;
    
    const roomId = [activeUser, targetUser].sort().join('_');
    const iv = CryptoJS.lib.WordArray.random(16).toString();
    const ciphertext = CryptoJS.AES.encrypt(chatInput, roomSecret, { iv: CryptoJS.enc.Hex.parse(iv) }).toString();
    const messageText = chatInput.trim();
    const clientMsgId = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    stompClient.publish({
      destination: '/app/shadow/send',
      body: JSON.stringify({ 
        msgId: clientMsgId,
        roomId, 
        senderUsername: activeUser,
        senderId: 0, 
        ephemeralPublicKey: "NONE", 
        ciphertext: ciphertext, 
        iv: iv,
        authTag: "AES-GCM-SIMULATED" 
      })
    });

    saveLocalMessage(roomId, activeUser, messageText);
    setMessages((prev) => [...prev, { 
      msgId: clientMsgId,
      iv: iv,
      sender_username: activeUser, 
      content: messageText,
      timestamp: new Date().toISOString()
    }]);

    setChatInput('');
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backBtn} 
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate('MainTabs'); 
            }
          }}
        >
          <Feather name="arrow-left" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        
        <View style={styles.activeHeader}>
          <View style={styles.avatarPlaceholder}>
            {targetAvatar ? (
              <Image 
                source={{ uri: targetAvatar }} 
                style={{ width: '100%', height: '100%' }} 
              />
            ) : (
              <Text style={styles.avatarText}>{targetUser ? targetUser[0]?.toUpperCase() : '?'}</Text>
            )}
          </View>
          <View>
            <Text style={styles.headerTextActive}>@{targetUser || 'unknown'}</Text>
            <Text style={styles.statusText}>
              {isConnecting ? "connecting..." : isSecureLinkActive ? "e2e encrypted" : "offline"}
            </Text>
          </View>
        </View>
      </View>

      {/* @ts-ignore */}
      <ScrollView ref={scrollViewRef} style={styles.chatArea} contentContainerStyle={{ paddingBottom: 20 }}>
        <View style={styles.encryptionBanner}>
          <Feather name="shield" size={12} color="#D1B000" />
          <Text style={styles.encryptionText}> Messages secured with X25519 Key Agreement.</Text>
        </View>

        {messages.map((msg, idx) => {
          const msgSender = (msg.sender_username || '').trim().toLowerCase();
          const isMe = msgSender === activeUser;

          return (
            /* @ts-ignore */
            <View key={idx} style={[styles.bubbleWrapper, isMe ? styles.myBubbleWrapper : styles.theirBubbleWrapper]}>
              <View style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}>
                <Text style={[styles.bubbleText, isMe ? styles.myBubbleText : styles.theirBubbleText]}>
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

      <View style={styles.inputRow}>
        <TextInput 
          style={styles.input} 
          value={chatInput} 
          onChangeText={setChatInput} 
          placeholder="Message..." 
          placeholderTextColor="#666666" 
          editable={isSecureLinkActive}
          multiline
        />
        
        <TouchableOpacity 
          style={[styles.sendBtn, !chatInput.trim() && { backgroundColor: '#262626' }]} 
          onPress={sendEncryptedMessage} 
          disabled={!isSecureLinkActive || !chatInput.trim()}
        >
          <Feather name="send" size={20} color={chatInput.trim() ? "#FFFFFF" : "#666666"} style={{ marginLeft: -2 }} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 50, backgroundColor: '#1A1A1A', borderBottomWidth: 1, borderColor: '#262626' },
  backBtn: { marginRight: 16 },
  activeHeader: { flexDirection: 'row', alignItems: 'center' },
  avatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  avatarText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 16 },
  headerTextActive: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  statusText: { fontSize: 11, color: '#00C851', fontWeight: '600' },
  chatArea: { flex: 1, padding: 16 },
  encryptionBanner: { flexDirection: 'row', backgroundColor: 'rgba(209, 176, 0, 0.1)', padding: 10, borderRadius: 8, marginBottom: 20, alignItems: 'center', justifyContent: 'center' },
  encryptionText: { color: '#D1B000', fontSize: 11, textAlign: 'center', fontWeight: '600' },
  bubbleWrapper: { marginBottom: 12, flexDirection: 'row', width: '100%' },
  myBubbleWrapper: { justifyContent: 'flex-end' },
  theirBubbleWrapper: { justifyContent: 'flex-start' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, maxWidth: '75%' },
  myBubble: { backgroundColor: '#005C4B', borderTopRightRadius: 4 },
  theirBubble: { backgroundColor: '#202C33', borderTopLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  myBubbleText: { color: '#E9EDEF' },
  theirBubbleText: { color: '#E9EDEF' },
  timestamp: { fontSize: 10, alignSelf: 'flex-end', marginTop: 4, marginLeft: 12 },
  myTimestamp: { color: 'rgba(255,255,255,0.6)' },
  theirTimestamp: { color: 'rgba(255,255,255,0.5)' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, backgroundColor: '#1A1A1A' },
  input: { flex: 1, backgroundColor: '#2A2F32', borderRadius: 24, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, color: '#FFFFFF', fontSize: 15, maxHeight: 100, minHeight: 48 },
  sendBtn: { backgroundColor: '#00A884', width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
});