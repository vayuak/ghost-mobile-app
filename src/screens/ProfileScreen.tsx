import React, { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Image, Modal, RefreshControl, Platform, Switch, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { apiClient, BASE_URL, systemLogout, uploadMultipart, buildFilePart, API_ROUTES } from '../services/api'; 
import PostCard from '../components/PostCard';
import { invalidateAvatar } from '../services/ProfileCache';

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
  
  const [isDarkMode, setIsDarkMode] = useState(true);
  const APP_VERSION = "1.0.0 (Build 102)";

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
      const activeUser = await AsyncStorage.getItem('@active_username');
      if (!activeUser) return;
      
      const response = await apiClient.get(`/v1/social/user/${encodeURIComponent(activeUser)}/full-profile`);
      setUserPosts(response.posts || []);
      
      if (response.profile?.profilePictureUrl) {
        setAvatarUri(response.profile.profilePictureUrl);
      }
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
        API_ROUTES.USERS.UPDATE_DP,
        formData,
        setUploadPercent
      );

      const newAvatarUrl = updateRes?.avatarUrl || updateRes?.profilePictureUrl || updateRes?.url;

      if (newAvatarUrl) {
        setAvatarUri(newAvatarUrl);
        await AsyncStorage.setItem('@user_avatar', newAvatarUrl);
        if (currentUsername) {
          await invalidateAvatar(currentUsername);
        }
      }
      
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Profile picture updated globally.'
      });
      
    } catch (e: any) {
      setAvatarUri(previousAvatar);
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
      await apiClient.delete(API_ROUTES.POSTS.DELETE(postId));
      setUserPosts(current => current.filter(post => String(post.id) !== String(postId)));
      
      Toast.show({
        type: 'success',
        text1: 'Success',
        text2: 'Post permanently deleted.'
      });
    } catch (e: any) {
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
        <Text style={styles.brandTitle}>ViaCustos<Text style={{ color: '#8E95A5' }}>GLIDE</Text></Text>
        <TouchableOpacity 
          onPress={() => setMenuVisible(true)} 
          style={styles.iconButton}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
        >
          <Feather name="settings" size={20} color="#FFF" />
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
                    onError={(err) => setImageError(true)}
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

      {/* Profile & Settings Modal */}
      <Modal visible={menuVisible} animationType="slide" transparent={true} onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setMenuVisible(false)} />
          <View style={styles.modalContent}>
            <Text style={styles.menuSectionHeader}>PREFERENCES</Text>
            <View style={styles.menuItemRow}>
              <Text style={styles.menuText}>Dark Theme</Text>
              <Switch value={isDarkMode} onValueChange={setIsDarkMode} trackColor={{ false: '#333', true: '#34C759' }} />
            </View>

            <TouchableOpacity style={styles.menuItemRow} onPress={() => { setMenuVisible(false); navigation.navigate('PremiumUpgrade'); }}>
              <Text style={[styles.menuText, { color: '#FBBF24', fontWeight: 'bold' }]}>✨ Upgrade to Premium</Text>
              <Feather name="chevron-right" size={18} color="#FBBF24" />
            </TouchableOpacity>

            <Text style={[styles.menuSectionHeader, { marginTop: 16 }]}>SUPPORT & HELP</Text>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => Linking.openURL('mailto:support@viacustos.com?subject=Bug%20Report')}>
              <Text style={styles.menuText}>Report a Bug</Text>
              <Feather name="external-link" size={16} color="#666" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItemRow} onPress={() => Linking.openURL('mailto:support@viacustos.com?subject=Feature%20Suggestion')}>
              <Text style={styles.menuText}>Suggest a Feature</Text>
              <Feather name="external-link" size={16} color="#666" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItemRow} onPress={() => Alert.alert("Help & FAQ", "ViaCustos AirDrops expire automatically after 10 minutes. Enable location permissions for real-time radar scanning.")}>
              <Text style={styles.menuText}>Help & FAQ</Text>
              <Feather name="help-circle" size={16} color="#666" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuItemRow} onPress={() => { setMenuVisible(false); navigation.navigate('BlockedUsers'); }}>
              <Text style={styles.menuText}>Blocked Users</Text>
              <Feather name="shield" size={16} color="#666" />
            </TouchableOpacity>

            <Text style={[styles.menuSectionHeader, { marginTop: 16 }]}>LEGAL</Text>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => Linking.openURL('https://viacustos.com/terms')}>
              <Text style={styles.menuText}>Terms of Service</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => Linking.openURL('https://viacustos.com/privacy')}>
              <Text style={styles.menuText}>Privacy Policy</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.menuItemRow, { marginTop: 20 }]} onPress={handleLogout}>
              <Feather name="log-out" size={18} color="#FF3B30" />
              <Text style={[styles.menuText, { color: '#FF3B30', marginLeft: 10 }]}>Logout</Text>
            </TouchableOpacity>

            <Text style={styles.versionText}>ViaCustos v{APP_VERSION}</Text>
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
  modalContent: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderWidth: 1, borderColor: '#262626' },
  menuSectionHeader: { color: '#666666', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  menuItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#262626' },
  menuText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  versionText: { textAlign: 'center', color: '#666', fontSize: 11, marginTop: 20, marginBottom: 10 }
});