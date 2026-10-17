import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native'; 
import { apiClient, BASE_URL, API_ROUTES } from '../services/api';
import PostCard from '../components/PostCard';
import { useTheme } from '../context/ThemeContext'; 

export default function PublicProfileScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  
  const { targetUser } = route.params;
  const cleanHandle = (targetUser || '').replace(/^@/, '').trim().toLowerCase();
  const isFocused = useIsFocused(); 
  const flatListRef = useRef<FlatList>(null);

  const [userProfile, setUserProfile] = useState<any>(null);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [visiblePosts, setVisiblePosts] = useState<string[]>([]);
  const [activeUser, setActiveUser] = useState('');

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => { setVisiblePosts(viewableItems.map((v: any) => String(v.item.id))); }).current;

  useEffect(() => { AsyncStorage.getItem('@active_username').then(user => { if (user) setActiveUser(user.toLowerCase()); }); }, []);

  useEffect(() => {
    const fetchData = async () => {
      const token = await AsyncStorage.getItem('@ghost_token');
      setAuthToken(token);
      try {
        const response = await apiClient.get(API_ROUTES.USERS.PROFILE(cleanHandle));
        setUserProfile(response.profile);
        setUserPosts(response.posts || []);
      } catch (error) {} finally { setIsLoading(false); }
    };
    fetchData();
  }, [cleanHandle]);

  const getFullAvatarUrl = (uri: string | null) => uri ? (uri.startsWith('http') ? uri : `${BASE_URL.replace(/\/$/, '')}${uri.startsWith('/') ? uri : `/${uri}`}`) : null;
  const fullAvatarUrl = getFullAvatarUrl(userProfile?.avatarUrl || userProfile?.profilePictureUrl);
  const isSelf = cleanHandle === activeUser;

  return (
    // 🟢 FIX: Main container is now fully themed
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topNav}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <Feather name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}>
          <Text style={styles.brandTitle}>@{cleanHandle}</Text>
        </TouchableOpacity>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.textMuted} style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          ref={flatListRef}
          data={userPosts}
          keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
          contentContainerStyle={{ paddingBottom: 40 }}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          ListHeaderComponent={
            <View style={styles.profileHeaderContainer}>
              <View style={styles.avatarGlow}>
                {fullAvatarUrl ? <Image source={{ uri: fullAvatarUrl, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.avatarImage} /> : <Feather name="user" size={48} color={colors.textMuted} />}
              </View>
              <Text style={styles.usernameText}>@{cleanHandle}</Text>
              {!isSelf && (
                <TouchableOpacity style={styles.messageBtn} onPress={() => navigation.navigate('GossipsChat', { targetUser: cleanHandle })}>
                  <Feather name="message-circle" size={16} color={colors.background} style={{ marginRight: 8 }} />
                  <Text style={styles.messageBtnText}>Message</Text>
                </TouchableOpacity>
              )}
              <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>POSTS</Text></View>
            </View>
          }
          renderItem={({ item }) => <PostCard post={item} isVisible={visiblePosts.includes(String(item.id)) && isFocused} />}
          ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 30 }}>No posts yet.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background }, // 🟢 FIX: Global theme BG
  topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, backgroundColor: colors.background },
  brandTitle: { color: colors.text, fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  profileHeaderContainer: { alignItems: 'center', paddingTop: 30, paddingHorizontal: 20 },
  avatarGlow: { width: 104, height: 104, borderRadius: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface, overflow: 'hidden', marginBottom: 16 },
  avatarImage: { width: '100%', height: '100%' },
  usernameText: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: 0.5, marginBottom: 16 },
  messageBtn: { flexDirection: 'row', backgroundColor: colors.text, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24, alignItems: 'center', marginBottom: 30 },
  messageBtnText: { color: colors.background, fontWeight: '800', fontSize: 14 },
  sectionHeader: { alignSelf: 'flex-start', marginBottom: 15 },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
});