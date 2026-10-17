import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { getBlockedUsers, unblockLocalUser } from '../services/LocalDB';
import { useTheme } from '../context/ThemeContext'; 

export default function BlockedUsersScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  
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
          <Feather name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>BLOCKED USERS</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={blockedUsers}
        keyExtractor={(item) => item}
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

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },
  
  // 🟢 FIX: Flat, seamless list rows. No ugly borders or table backgrounds.
  userRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  username: { color: colors.text, fontSize: 16, fontWeight: '700' },
  
  // 🟢 FIX: Elegant Insta-style outlined button
  unblockBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  unblockText: { color: colors.text, fontSize: 13, fontWeight: '700' }
});