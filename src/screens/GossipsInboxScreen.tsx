import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Image, ActivityIndicator, Alert, DeviceEventEmitter } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { apiClient, BASE_URL, API_ROUTES } from '../services/api';
import { getRecentConversations, clearLocalMessages } from '../services/LocalDB';
import { useTheme } from '../context/ThemeContext'; 

interface InboxThread { roomId: string; targetUser: string; lastMessage: string; timestamp: string; unreadCount: number; }

export default function GossipsInboxScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [avatars, setAvatars] = useState<{ [username: string]: string }>({});
  const [isLoading, setIsLoading] = useState(true);
  const [activeUser, setActiveUser] = useState<string>('');
  const [authToken, setAuthToken] = useState<string | null>(null); 

  useEffect(() => {
    AsyncStorage.getItem('@active_username').then(user => { if (user) setActiveUser(user.replace(/^@/, '').trim().toLowerCase()); });
    AsyncStorage.getItem('@ghost_token').then(setAuthToken);
  }, []);

  const loadInbox = () => {
    if (!activeUser) return;
    try { setThreads(getRecentConversations(activeUser)); hydrateAvatars(getRecentConversations(activeUser).map(x => x.targetUser)); } 
    finally { setIsLoading(false); }
  };

  const hydrateAvatars = async (usernames: string[]) => {
    const uniqueUsers = Array.from(new Set(usernames.map(u => u.replace(/^@/, '').trim().toLowerCase()).filter(Boolean)));
    for (const user of uniqueUsers) {
      if (avatars[user]) continue; 
      try {
        const response = await apiClient.get(API_ROUTES.USERS.PROFILE(user));
        const rawUrl = response?.profile?.avatarUrl || response?.profile?.profilePictureUrl || response?.avatarUrl;
        if (rawUrl) setAvatars(prev => ({ ...prev, [user]: rawUrl.startsWith('http') ? rawUrl : `${BASE_URL.replace(/\/$/, '')}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}` }));
      } catch (e) { }
    }
  };

  useFocusEffect(useCallback(() => { if (activeUser) loadInbox(); }, [activeUser]));

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('db_chats_updated', () => { if (activeUser) loadInbox(); });
    return () => subscription.remove();
  }, [activeUser]);

  const handleLongPress = (roomId: string, targetUser: string) => {
    Alert.alert('Manage Chat', `Options for @${targetUser}`, [
        { text: 'Clear History', onPress: () => { clearLocalMessages(roomId, true, targetUser, activeUser); loadInbox(); }},
        { text: 'Delete Chat', style: 'destructive', onPress: () => { clearLocalMessages(roomId, false); loadInbox(); }},
        { text: 'Cancel', style: 'cancel' }
      ], { cancelable: true }
    );
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    const today = new Date(); return d.toDateString() === today.toDateString() ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CHATS</Text>
        <TouchableOpacity hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }} onPress={() => navigation.navigate('Home', { autoSearch: '@' })}><Feather name="edit" size={20} color={colors.text} /></TouchableOpacity>
      </View>

      {isLoading ? <ActivityIndicator size="large" color={colors.textMuted} style={{ marginTop: 50 }} /> : (
        <FlatList data={threads} keyExtractor={(item) => item.roomId} contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item }) => {
            const avatarUrl = avatars[item.targetUser];
            return (
              <TouchableOpacity style={styles.threadRow} onPress={() => navigation.navigate('GossipsChat', { targetUser: item.targetUser })} onLongPress={() => handleLongPress(item.roomId, item.targetUser)}>
                <TouchableOpacity style={styles.avatarContainer} onPress={() => navigation.navigate('PublicProfile', { targetUser: item.targetUser })}>
                  {avatarUrl ? <Image source={{ uri: avatarUrl, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.avatarImage} /> : <View style={styles.avatarPlaceholder}><Text style={styles.avatarLetter}>{item.targetUser ? item.targetUser[0].toUpperCase() : '?'}</Text></View>}
                </TouchableOpacity>
                <View style={styles.threadContent}>
                  <View style={styles.threadHeader}><Text style={styles.threadUsername} numberOfLines={1}>@{item.targetUser}</Text><Text style={styles.threadTime}>{formatTime(item.timestamp)}</Text></View>
                  <View style={styles.threadFooter}>
                    <Text style={[styles.threadLastMessage, item.unreadCount > 0 && styles.threadLastMessageUnread]} numberOfLines={1}>{item.lastMessage}</Text>
                    {/* 🟢 FIX: Exact WhatsApp Badge Styling */}
                    {item.unreadCount > 0 && <View style={styles.unreadBadge}><Text style={styles.unreadBadgeText}>{item.unreadCount}</Text></View>}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}><Feather name="message-circle" size={50} color={colors.border} /><Text style={styles.emptyTitle}>No Chats Yet</Text><Text style={styles.emptySub}>Search for users to start an encrypted conversation.</Text></View>
          }
        />
      )}
    </SafeAreaView>
  );
}

// 🟢 FIX: Removed `borderBottomWidth` from threadRow
const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, backgroundColor: colors.background },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: '800', letterSpacing: 1 },
  threadRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12 }, 
  avatarContainer: { marginRight: 14 },
  avatarImage: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface },
  avatarPlaceholder: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' },
  avatarLetter: { color: colors.text, fontSize: 20, fontWeight: 'bold' },
  threadContent: { flex: 1, justifyContent: 'center', paddingBottom: 4 }, 
  threadHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  threadUsername: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, paddingRight: 10 },
  threadTime: { color: colors.textMuted, fontSize: 12, fontWeight: '500' },
  threadFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  threadLastMessage: { color: colors.textMuted, fontSize: 14, flex: 1, paddingRight: 15 },
  threadLastMessageUnread: { color: colors.text, fontWeight: '600' },
  unreadBadge: { backgroundColor: '#25D366', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, minWidth: 22, alignItems: 'center' },
  unreadBadgeText: { color: '#FFF', fontSize: 11, fontWeight: 'bold' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: '40%' },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginTop: 16 },
  emptySub: { color: colors.textMuted, fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 }
});