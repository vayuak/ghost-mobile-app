import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, BASE_URL } from '../services/api';
import PostCard from '../components/PostCard';

export default function PublicProfileScreen({ route, navigation }: any) {
  const { targetUser } = route.params;
  const [userProfile, setUserProfile] = useState<any>(null);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [visiblePosts, setVisiblePosts] = useState<string[]>([]);
  
  // 🟢 Hides message button on own profile
  const [activeUser, setActiveUser] = useState('');

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    setVisiblePosts(viewableItems.map((v: any) => String(v.item.id)));
  }).current;

  useEffect(() => {
    AsyncStorage.getItem('@active_username').then(user => {
      if (user) setActiveUser(user.toLowerCase());
    });
  }, []);

useEffect(() => {
    const fetchData = async () => {
      const token = await AsyncStorage.getItem('@ghost_token');
      setAuthToken(token);

      try {
        // 🟢 Strip '@' symbol and spaces to prevent URL path mismatch
        const cleanHandle = targetUser.replace(/^@/, '').trim().toLowerCase();
        const response = await apiClient.get(`/api/social/user/${cleanHandle}/full-profile`);
        
        setUserProfile(response.profile);
        setUserPosts(response.posts || []);
      } catch (error) {
        console.warn("Failed to load public profile:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [targetUser]);
  const getFullAvatarUrl = (uri: string | null) => {
    if (!uri) return null;
    if (uri.startsWith('http')) return uri;
    return `${BASE_URL.replace(/\/$/, '')}${uri.startsWith('/') ? uri : `/${uri}`}`;
  };

  const fullAvatarUrl = getFullAvatarUrl(userProfile?.avatarUrl || userProfile?.profilePictureUrl);
  const isSelf = targetUser.toLowerCase() === activeUser;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topNav}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <Feather name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.brandTitle}>@{targetUser}</Text>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color="#666" style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={userPosts}
          keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
          contentContainerStyle={{ paddingBottom: 40 }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          ListHeaderComponent={
            <View style={styles.profileHeaderContainer}>
              <View style={styles.avatarGlow}>
                {fullAvatarUrl ? (
                  <Image source={{ uri: fullAvatarUrl, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.avatarImage} />
                ) : (
                  <Feather name="user" size={48} color="#4A5060" />
                )}
              </View>

              <Text style={styles.usernameText}>@{targetUser}</Text>

              {/* 🟢 Hides the Message button if this is the active user */}
              {!isSelf && (
                <TouchableOpacity style={styles.messageBtn} onPress={() => navigation.navigate('GossipsChat', { targetUser })}>
                  <Feather name="message-circle" size={16} color="#000" style={{ marginRight: 8 }} />
                  <Text style={styles.messageBtnText}>Message</Text>
                </TouchableOpacity>
              )}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>POSTS</Text>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <PostCard post={item} isVisible={visiblePosts.includes(String(item.id))} />
          )}
          ListEmptyComponent={<Text style={{ color: '#666', textAlign: 'center', marginTop: 30 }}>No posts yet.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  brandTitle: { color: '#FFF', fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  profileHeaderContainer: { alignItems: 'center', paddingTop: 30, paddingHorizontal: 20 },
  avatarGlow: { width: 104, height: 104, borderRadius: 52, borderWidth: 1, borderColor: '#262626', justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1A1A', overflow: 'hidden', marginBottom: 16 },
  avatarImage: { width: '100%', height: '100%' },
  usernameText: { color: '#FFF', fontSize: 22, fontWeight: '800', letterSpacing: 0.5, marginBottom: 16 },
  messageBtn: { flexDirection: 'row', backgroundColor: '#FFF', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, alignItems: 'center', marginBottom: 30 },
  messageBtnText: { color: '#000', fontWeight: '800', fontSize: 14 },
  sectionHeader: { alignSelf: 'flex-start', marginBottom: 15 },
  sectionTitle: { color: '#666666', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
});