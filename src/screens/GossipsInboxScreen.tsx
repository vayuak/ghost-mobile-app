import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { getRecentConversations } from '../services/LocalDB';

interface InboxThread {
  roomId: string;
  targetUser: string;
  lastMessage: string;
  timestamp: string;
}

export default function GossipsInboxScreen({ navigation }: any) {
  const isFocused = useIsFocused();
  const [threads, setThreads] = useState<InboxThread[]>([]);

  useEffect(() => {
    if (isFocused) {
      loadInbox();
    }
  }, [isFocused]);

  const loadInbox = async () => {
    try {
      // 🟢 FIX: Removed @ symbol from AsyncStorage keys
      const activeUser = await AsyncStorage.getItem('active_username') || '';
      const recentChats = getRecentConversations(activeUser) as InboxThread[];
      setThreads(recentChats);
    } catch (e) {
      console.warn('Failed to load local inbox');
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const today = new Date();
      if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Encrypted Inbox</Text>
        <Feather name="lock" size={16} color="#00C851" />
      </View>

      <FlatList
        data={threads}
        keyExtractor={(item) => item.roomId}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Feather name="message-square" size={48} color="#262626" />
            <Text style={styles.emptyText}>No Encrypted Chats Yet</Text>
            <Text style={styles.emptySubText}>Search for a user to start an end-to-end encrypted conversation.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={styles.chatRow}
            onPress={() => navigation.navigate('GossipsChat', { targetUser: item.targetUser })}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.targetUser[0]?.toUpperCase()}</Text>
            </View>
            
            <View style={styles.chatInfo}>
              <View style={styles.topLine}>
                <Text style={styles.username}>@{item.targetUser}</Text>
                <Text style={styles.time}>{formatTime(item.timestamp)}</Text>
              </View>
              
              <Text style={styles.messagePreview} numberOfLines={1}>
                {item.lastMessage.startsWith('[B64_IMG]') ? '📷 Photo' : item.lastMessage}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    padding: 16, 
    borderBottomWidth: 1, 
    borderColor: '#1A1A1A' 
  },
  headerTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: 0.5 },
  listContainer: { flexGrow: 1 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 100, paddingHorizontal: 32 },
  emptyText: { color: '#A3A3A3', fontSize: 16, fontWeight: '700', marginTop: 16 },
  emptySubText: { color: '#525252', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  chatRow: { 
    flexDirection: 'row', 
    padding: 16, 
    borderBottomWidth: 1, 
    borderColor: '#121212',
    alignItems: 'center'
  },
  avatar: { 
    width: 50, 
    height: 50, 
    borderRadius: 25, 
    backgroundColor: '#262626', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginRight: 16 
  },
  avatarText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  chatInfo: { flex: 1, justifyContent: 'center' },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  username: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  time: { color: '#666666', fontSize: 12, fontWeight: '600' },
  messagePreview: { color: '#A3A3A3', fontSize: 14, lineHeight: 20 },
});