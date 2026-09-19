import React, { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Image, Modal, Alert, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message'; // 🟢 Added Toast
import { apiClient, BASE_URL, systemLogout, uploadMultipart, buildFilePart, API_ROUTES } from '../services/api'; 
import PostCard from '../components/PostCard';

export default function ProfileScreen({ navigation, onLogoutTrigger }: any) {
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string>('loading...');
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const loadSessionData = async () => {
      const token = await AsyncStorage.getItem('@ghost_token');
      setAuthToken(token);

      if (token) {
        try {
          const response = await apiClient.get(API_ROUTES.AUTH.ME);
          setCurrentUsername(response.username);
          if (response.profilePictureUrl) {
            setAvatarUri(response.profilePictureUrl);
            await AsyncStorage.setItem('@user_avatar', response.profilePictureUrl);
          }
        } catch (error) {
          console.error("Failed to load user profile:", error);
          const savedUser = await AsyncStorage.getItem('@active_username');
          const savedAvatar = await AsyncStorage.getItem('@user_avatar');
          if (savedUser) setCurrentUsername(savedUser);
          if (savedAvatar) setAvatarUri(savedAvatar);
        }
      }
    };
    loadSessionData();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchUserProfileAndLogs();
    }, [])
  );

  const fetchUserProfileAndLogs = async () => {
    try {
      const res = await apiClient.get(API_ROUTES.PROFILE.MY_POSTS);
      const posts = Array.isArray(res) ? res : res.content || [];
      setUserPosts(posts);
    } catch (e) {
      console.error("Failed to load personal logs", e);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchUserProfileAndLogs();
  };

  const handleLogout = async () => {
    setMenuVisible(false);
    await systemLogout();
    if (onLogoutTrigger) {
      onLogoutTrigger();
    } else {
      const parentNav = navigation.getParent();
      if (parentNav) {
        parentNav.reset({ index: 0, routes: [{ name: 'Login' }] });
      } else {
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
    }
  };

  const handleEditProfileDP = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    const previousAvatar = avatarUri;
    setAvatarUri(asset.uri);
    setImageError(false);
    setUploadPercent(0);

    try {
      const formData = new FormData();
      const filePart = buildFilePart(asset);

      if (Platform.OS === 'web') {
        const res = await fetch(asset.uri);
        const blob = await res.blob();
        formData.append('file', blob, filePart.name);
      } else {
        formData.append('file', filePart);
      }

      const updateRes = await uploadMultipart(
        API_ROUTES.PROFILE.UPDATE_DP,
        formData,
        setUploadPercent
      );

      const newAvatarUrl = updateRes?.avatarUrl || updateRes?.profilePictureUrl || updateRes?.url;

      if (newAvatarUrl) {
        setAvatarUri(newAvatarUrl);
        await AsyncStorage.setItem('@user_avatar', newAvatarUrl);
      }
      
      // 🟢 Replaced Alert with Toast
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Profile picture updated globally.'
      });
      
    } catch (e: any) {
      setAvatarUri(previousAvatar);
      // 🟢 Replaced Alert with Toast
      Toast.show({
        type: 'error',
        text1: 'Upload Failed',
        text2: e.message || "Could not update profile picture."
      });
    } finally {
      setUploadPercent(null);
    }
  };

  const handleDeletePost = async (postId: any) => {
    try {
      await apiClient.delete(API_ROUTES.PROFILE.DELETE_POST(postId));
      setUserPosts(current => current.filter(post => String(post.id) !== String(postId)));
      
      // 🟢 Replaced Alert with Toast
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Post permanently deleted.'
      });
    } catch (e: any) {
      // 🟢 Replaced Alert with Toast
      Toast.show({
        type: 'error',
        text1: 'Delete Failed',
        text2: e.message || "An unknown network error occurred."
      });
    }
  };

  const getFullAvatarUrl = (uri: string | null) => {
    if (!uri) return null;
    if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('file://') || uri.startsWith('data:') || uri.startsWith('blob:')) {
      return uri;
    }
    const cleanBase = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;
    const cleanPath = uri.startsWith('/') ? uri : `/${uri}`;
    return `${cleanBase}${cleanPath}`;
  };

  const fullAvatarUrl = getFullAvatarUrl(avatarUri);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topNav}>
        <Text style={styles.brandTitle}>GHOST<Text style={{ color: '#8E95A5' }}>SHIELD</Text></Text>
        {/* 🟢 Added hitSlop */}
        <TouchableOpacity 
          onPress={() => setMenuVisible(true)} 
          style={styles.iconButton}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
        >
          <Feather name="more-vertical" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={userPosts}
        keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#FFF" />}
        ListHeaderComponent={
          <View style={styles.profileHeaderContainer}>
            <View style={styles.avatarWrapper}>
              <View style={styles.avatarGlow}>
                {fullAvatarUrl && !imageError ? (
                  <Image
                    source={{
                      uri: fullAvatarUrl,
                      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                    }}
                    style={styles.avatarImage}
                    onError={(err) => {
                      console.warn("Avatar load failed:", fullAvatarUrl, err.nativeEvent.error);
                      setImageError(true);
                    }}
                  />
                ) : (
                  <Feather name="user" size={48} color="#4A5060" />
                )}
              </View>
              <TouchableOpacity
                style={styles.cameraBadge}
                onPress={handleEditProfileDP}
                disabled={uploadPercent !== null}
              >
                <Ionicons name="camera" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>

            {uploadPercent !== null && (
              <Text style={styles.uploadText}>Uploading {uploadPercent}%</Text>
            )}

            <View style={styles.identityContainer}>
              <Text style={styles.usernameText}>@{currentUsername}</Text>
            </View>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>MY POSTS</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <PostCard post={item} currentUsername={currentUsername} onDelete={handleDeletePost} />
        )}
      />

      {/* 🟢 Added onRequestClose for Android back swipe */}
      <Modal visible={menuVisible} animationType="slide" transparent={true} onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setMenuVisible(false)} />
          <View style={styles.modalContent}>
            <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
              <Feather name="log-out" size={20} color="#FF3B30" />
              <Text style={[styles.menuText, { color: '#FF3B30' }]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, backgroundColor: '#000000' },
  brandTitle: { color: '#FFF', fontSize: 18, fontWeight: '900', letterSpacing: 1.5 },
  iconButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#262626' },
  profileHeaderContainer: { alignItems: 'center', paddingTop: 10, paddingHorizontal: 20 },
  avatarWrapper: { position: 'relative', marginBottom: 15 },
  avatarGlow: { width: 104, height: 104, borderRadius: 52, borderWidth: 1, borderColor: '#262626', justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1A1A', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  cameraBadge: { position: 'absolute', bottom: 2, right: 2, backgroundColor: '#262626', width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#404040' },
  uploadText: { color: '#8E95A5', fontSize: 12, fontWeight: '700', marginBottom: 10, letterSpacing: 1 },
  identityContainer: { alignItems: 'center', marginBottom: 20 },
  usernameText: { color: '#FFF', fontSize: 22, fontWeight: '800', letterSpacing: 0.5, marginBottom: 6 },
  sectionHeader: { alignSelf: 'flex-start', marginBottom: 15, marginTop: 20 },
  sectionTitle: { color: '#666666', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: '#262626' },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  menuText: { fontSize: 15, fontWeight: '700', marginLeft: 14 }
});