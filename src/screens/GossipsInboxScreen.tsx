import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Image, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { apiClient, BASE_URL } from '../services/api';
import { getRecentConversations } from '../services/LocalDB';

interface Conversation {
  roomId: string;
  targetUser: string;
  lastMessage: string;
  timestamp: string;
  avatarUrl?: string | null;
}

export default function GossipsInboxScreen({ navigation }: any) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadInbox();
    });
    return unsubscribe;
  }, [navigation]);

  const loadInbox = async () => {
    setLoading(true);
    try {
      const activeUser = (await AsyncStorage.getItem('@active_username') || '').trim().toLowerCase();
      
      // 1. Fetch conversations from local SQLite DB
      let rawChats = getRecentConversations(activeUser);

      // 2. Hydrate target user avatars
      const hydratedChats = await Promise.all(
        rawChats.map(async (chat: any) => {
          try {
            const profile = await apiClient.get(`/v1/social/user/${chat.targetUser}/profile`);
            return { ...chat, avatarUrl: profile.avatarUrl || profile.profilePictureUrl || null };
          } catch {
            return { ...chat, avatarUrl: null };
          }
        })
      );

      setConversations(hydratedChats);
    } catch (e) {
      console.error("Failed to load inbox:", e);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gossips</Text>
        <TouchableOpacity style={styles.newChatBtn} onPress={() => navigation.navigate('Home')}>
          <Feather name="edit-3" size={20} color="#00C851" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#00C851" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.roomId}
          renderItem={({ item }) => {
            const avatarUri = item.avatarUrl
              ? (item.avatarUrl.startsWith('http') ? item.avatarUrl : `${BASE_URL}${item.avatarUrl}`)
              : null;

            return (
              <TouchableOpacity
                style={styles.chatRow}
                onPress={() => navigation.navigate('GossipsChat', { targetUser: item.targetUser })}
              >
                <View style={styles.avatarContainer}>
                  {avatarUri ? (
                    <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarText}>{item.targetUser[0]?.toUpperCase()}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.chatInfo}>
                  <View style={styles.topRow}>
                    <Text style={styles.username}>@{item.targetUser}</Text>
                    <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
                  </View>
                  <Text style={styles.lastMessage} numberOfLines={1}>
                    {item.lastMessage}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Feather name="message-square" size={48} color="#262626" />
              <Text style={styles.emptyText}>No active conversations</Text>
              <Text style={styles.emptySubtext}>Search for a user on the Home tab to start a gossip.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  newChatBtn: { padding: 8, backgroundColor: '#1A1A1A', borderRadius: 20 },
  chatRow: { flexDirection: 'row', padding: 16, borderBottomWidth: 1, borderColor: '#141414', alignItems: 'center' },
  avatarContainer: { width: 50, height: 50, borderRadius: 25, marginRight: 14, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarFallback: { width: '100%', height: '100%', backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 18 },
  chatInfo: { flex: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  username: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  time: { color: '#666666', fontSize: 11, fontWeight: '600' },
  lastMessage: { color: '#8E95A5', fontSize: 14 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 100, paddingHorizontal: 32 },
  emptyText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', marginTop: 16 },
  emptySubtext: { color: '#666666', fontSize: 13, textAlign: 'center', marginTop: 8 }
});