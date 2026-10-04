import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, BASE_URL, API_ROUTES } from '../services/api';
import { getLocalMessages } from '../services/LocalDB';

interface InboxThread {
  roomId: string;
  targetUser: string;
  lastMessage: string;
  timestamp: string;
  unreadCount: number;
}

export default function GossipsInboxScreen({ navigation }: any) {
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [avatars, setAvatars] = useState<{ [username: string]: string }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [activeUser, setActiveUser] = useState<string>('');

  useEffect(() => {
    AsyncStorage.getItem('@active_username').then(user => {
      if (user) setActiveUser(user.replace(/^@/, '').trim().toLowerCase());
    });
  }, []);

  const loadInbox = async () => {
    if (!activeUser) return;
    
    try {
      const allMessages = getLocalMessages(''); 
      const threadMap = new Map<string, InboxThread>();
      
      allMessages.forEach((msg: any) => {
        const isMe = msg.sender_username === activeUser;
        const rawTarget = isMe ? msg.target_username : msg.sender_username;
        const target = (rawTarget || '').replace(/^@/, '').trim().toLowerCase();
        if (!target) return;

        const existing = threadMap.get(target);
        if (!existing || new Date(msg.timestamp) > new Date(existing.timestamp)) {
          threadMap.set(target, {
            roomId: msg.roomId || [activeUser, target].sort().join('_'),
            targetUser: target,
            lastMessage: msg.content?.startsWith('DATA_IMAGE::') ? '📷 Image' : msg.content,
            timestamp: msg.timestamp,
            unreadCount: (!isMe && !msg.isRead) ? (existing?.unreadCount || 0) + 1 : (existing?.unreadCount || 0)
          });
        } else if (!isMe && !msg.isRead) {
          existing.unreadCount += 1;
        }
      });

      const sortedThreads = Array.from(threadMap.values()).sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      setThreads(sortedThreads);
      hydrateAvatars(sortedThreads.map(t => t.targetUser));

    } catch (e) {
      console.error("Failed to load inbox", e);
    } finally {
      setIsLoading(false);
    }
  };

  const hydrateAvatars = async (usernames: string[]) => {
    const uniqueUsers = Array.from(new Set(usernames.map(u => u.replace(/^@/, '').trim().toLowerCase()).filter(Boolean)));
    
    for (const user of uniqueUsers) {
      if (avatars[user]) continue; 

      try {
        const response = await apiClient.get(API_ROUTES.SOCIAL.USER_PROFILE(user));
        if (response && (response.avatarUrl || response.profilePictureUrl)) {
          const rawUrl = response.avatarUrl || response.profilePictureUrl;
          const fullUrl = rawUrl.startsWith('http') 
            ? rawUrl 
            : `${BASE_URL.replace(/\/$/, '')}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
          
          setAvatars(prev => ({ ...prev, [user]: fullUrl }));
        }
      } catch (e) { }
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (activeUser) loadInbox();
    }, [activeUser])
  );

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  };

  const renderItem = ({ item }: { item: InboxThread }) => {
    const avatarUrl = avatars[item.targetUser];

    return (
      <TouchableOpacity 
        style={styles.threadRow} 
        onPress={() => navigation.navigate('GossipsChat', { targetUser: item.targetUser })}
      >
        <TouchableOpacity 
          style={styles.avatarContainer} 
          onPress={() => navigation.navigate('PublicProfile', { targetUser: item.targetUser })}
        >
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarLetter}>{item.targetUser ? item.targetUser[0].toUpperCase() : '?'}</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.threadContent}>
          <View style={styles.threadHeader}>
            <Text style={styles.threadUsername} numberOfLines={1}>@{item.targetUser}</Text>
            <Text style={styles.threadTime}>{formatTime(item.timestamp)}</Text>
          </View>
          
          <View style={styles.threadFooter}>
            <Text style={[styles.threadLastMessage, item.unreadCount > 0 && styles.threadLastMessageUnread]} numberOfLines={1}>
              {item.lastMessage}
            </Text>
            {item.unreadCount > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{item.unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>GOSSIPS</Text>
        {/* 🟢 Pencil Icon redirects to Home search with @ focus */}
        <TouchableOpacity 
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          onPress={() => navigation.navigate('Home', { autoSearch: '@' })}
        >
          <Feather name="edit" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#666" style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(item) => item.roomId}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 20 }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather name="message-circle" size={50} color="#262626" />
              <Text style={styles.emptyTitle}>No Chats Yet</Text>
              <Text style={styles.emptySub}>Search for users to start an encrypted conversation.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  threadRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#111' },
  avatarContainer: { marginRight: 14 },
  avatarImage: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#262626' },
  avatarPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center' },
  avatarLetter: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  threadContent: { flex: 1, justifyContent: 'center' },
  threadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  threadUsername: { color: '#FFF', fontSize: 16, fontWeight: '700', flex: 1, paddingRight: 10 },
  threadTime: { color: '#666', fontSize: 12, fontWeight: '500' },
  threadFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  threadLastMessage: { color: '#8E95A5', fontSize: 14, flex: 1, paddingRight: 15 },
  threadLastMessageUnread: { color: '#E9EDEF', fontWeight: '600' },
  unreadBadge: { backgroundColor: '#34C759', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, minWidth: 20, alignItems: 'center' },
  unreadBadgeText: { color: '#000', fontSize: 11, fontWeight: '800' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: '40%' },
  emptyTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', marginTop: 16 },
  emptySub: { color: '#666', fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 }
});