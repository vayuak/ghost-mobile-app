import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getBlockedUsers, unblockLocalUser } from '../services/LocalDB';

export default function BlockedUsersScreen({ navigation }: any) {
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      setBlockedUsers(getBlockedUsers() || []);
    }, [])
  );

  const handleUnblock = (username: string) => {
    unblockLocalUser(username);
    setBlockedUsers(current => current.filter(u => u !== username));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <Feather name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>BLOCKED USERS</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={blockedUsers}
        keyExtractor={(item) => item}
        contentContainerStyle={{ padding: 20 }}
        ListEmptyComponent={
          <Text style={styles.emptyText}>You haven't blocked anyone.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.userRow}>
            <Text style={styles.username}>@{item}</Text>
            <TouchableOpacity style={styles.unblockBtn} onPress={() => handleUnblock(item)}>
              <Text style={styles.unblockText}>Unblock</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  headerTitle: { color: '#FFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  emptyText: { color: '#666', textAlign: 'center', marginTop: 40, fontSize: 14 },
  userRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1A1A1A', padding: 16, borderRadius: 8, marginBottom: 10, borderWidth: 1, borderColor: '#262626' },
  username: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  unblockBtn: { backgroundColor: '#262626', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#404040' },
  unblockText: { color: '#FFF', fontSize: 12, fontWeight: '800' }
});