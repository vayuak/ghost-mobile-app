import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Image, RefreshControl, DeviceEventEmitter, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { getRecentConversations, clearLocalMessages } from '../services/LocalDB';
import { preloadAvatars, peekAvatarUrl } from '../services/ProfileCache';

interface Conversation {
  roomId: string;
  targetUser: string;
  lastMessage: string;
  timestamp: string;
}

export default function GossipsInboxScreen({ navigation }: any) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [ready, setReady] = useState(false);
  const insets = useSafeAreaInsets();

  const loadInbox = useCallback(async () => {
    try {
      const me = ((await AsyncStorage.getItem('@active_username')) || '').trim().toLowerCase();
      const rows = getRecentConversations(me) as Conversation[];
      setConversations(rows);

      if (rows.length) {
        await preloadAvatars(rows.map((r) => r.targetUser));
        setAvatarVersion((v) => v + 1);
      }
    } catch (e) {
      console.warn('[Inbox] load failed:', e);
    } finally {
      setReady(true);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // 🟢 Reloads when you click the tab
    const unsubFocus = navigation.addListener('focus', loadInbox);
    
    // 🟢 Reloads instantly when a background message arrives from GlobalNetworkManager
    const unsubEvent = DeviceEventEmitter.addListener('db_chats_updated', loadInbox);
    
    loadInbox();
    
    return () => {
      unsubFocus();
      unsubEvent.remove();
    };
  }, [navigation, loadInbox]);

  const onRefresh = () => {
    setRefreshing(true);
    loadInbox();
  };

  const handleLongPress = (targetUser: string, roomId: string) => {
    Alert.alert(
      `Options for @${targetUser}`,
      'Manage this conversation:',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Clear Chat History', 
          style: 'destructive',
          onPress: () => {
            Alert.alert('Confirm', 'Delete this entire conversation?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => {
                  clearLocalMessages(roomId);
                  loadInbox();
                }
              }
            ]);
          }
        }
      ]
    );
  };

  const formatStamp = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    if (now.getTime() - d.getTime() < 7 * 24 * 3600 * 1000) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const renderRow = ({ item }: { item: Conversation }) => {
    const avatarUri = peekAvatarUrl(item.targetUser);

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('GossipsChat', { targetUser: item.targetUser })}
        onLongPress={() => handleLongPress(item.targetUser, item.roomId)} // 🟢 WhatsApp style hold-to-delete
        activeOpacity={0.7}
      >
        <View style={styles.avatarWrap}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarLetter}>{item.targetUser[0]?.toUpperCase() || '?'}</Text>
            </View>
          )}
        </View>

        <View style={styles.info}>
          <View style={styles.topLine}>
            <Text style={styles.username} numberOfLines={1}>@{item.targetUser}</Text>
            <Text style={styles.stamp}>{formatStamp(item.timestamp)}</Text>
          </View>
          <Text style={styles.preview} numberOfLines={1}>{item.lastMessage}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gossips</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('Home')}>
          <Feather name="edit-3" size={20} color="#A3A3A3" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={conversations}
        extraData={avatarVersion}
        keyExtractor={(item) => item.roomId}
        renderItem={renderRow}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={9}
        removeClippedSubviews
        ListEmptyComponent={
          ready ? (
            <View style={styles.empty}>
              <Feather name="message-square" size={48} color="#262626" />
              <Text style={styles.emptyText}>No conversations yet</Text>
              <Text style={styles.emptySub}>
                Find someone on the Home tab to start a gossip. Your history stays on this phone.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  headerTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  newBtn: { padding: 8, backgroundColor: '#1A1A1A', borderRadius: 20 },
  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#141414', alignItems: 'center' },
  avatarWrap: { width: 50, height: 50, borderRadius: 25, marginRight: 14, overflow: 'hidden', backgroundColor: '#262626' },
  avatarImg: { width: '100%', height: '100%' },
  avatarFallback: { width: '100%', height: '100%', backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center' },
  avatarLetter: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 18 },
  info: { flex: 1 },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' },
  username: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', flexShrink: 1, marginRight: 8 },
  stamp: { color: '#666666', fontSize: 11, fontWeight: '600' },
  preview: { color: '#8E95A5', fontSize: 14 },
  empty: { alignItems: 'center', justifyContent: 'center', marginTop: 90, paddingHorizontal: 36 },
  emptyText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', marginTop: 16 },
  emptySub: { color: '#666666', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 19 },
});