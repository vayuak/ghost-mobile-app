import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Image, Modal, RefreshControl, Platform, Linking, Switch } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { apiClient, BASE_URL, systemLogout, uploadMultipart, buildFilePart, API_ROUTES } from '../services/api'; 
import PostCard from '../components/PostCard';
import { useTheme } from '../context/ThemeContext';
import { invalidateAvatar } from '../services/ProfileCache';

export default function ProfileScreen({ navigation, onLogoutTrigger }: any) {
  const { colors, isDarkMode, toggleTheme } = useTheme();
  const styles = getStyles(colors);
  
  const isFocused = useIsFocused(); 
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null); 
  
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string>('loading...');
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [imageError, setImageError] = useState(false);
  
  // 🟢 FIX: Replaced Alert.alert with this sleek state
  const [deleteModal, setDeleteModal] = useState({ visible: false, targetId: null as any });
  
  const [visiblePosts, setVisiblePosts] = useState<string[]>([]);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => { setVisiblePosts(viewableItems.map((v: any) => String(v.item.id))); }).current;

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

  useFocusEffect(useCallback(() => { fetchUserProfileAndLogs(); }, []));

  const fetchUserProfileAndLogs = async () => {
    try {
      const activeUser = await AsyncStorage.getItem('@active_username');
      if (!activeUser) return;
      const response = await apiClient.get(`/v1/social/user/${encodeURIComponent(activeUser)}/full-profile`);
      setUserPosts(response.posts || []);
      if (response.profile?.profilePictureUrl) setAvatarUri(response.profile.profilePictureUrl);
    } catch (e) {} 
    finally { setIsLoading(false); setIsRefreshing(false); }
  };

  const handleRefresh = () => { setIsRefreshing(true); fetchUserProfileAndLogs(); };

  const handleLogout = async () => {
    setMenuVisible(false);
    await systemLogout();
    if (onLogoutTrigger) onLogoutTrigger();
    else { const parentNav = navigation.getParent(); if (parentNav) parentNav.reset({ index: 0, routes: [{ name: 'Login' }] }); else navigation.reset({ index: 0, routes: [{ name: 'Login' }] }); }
  };

  const handleEditProfileDP = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (result.canceled) return;
    const asset = result.assets[0];
    const previousAvatar = avatarUri;
    setAvatarUri(asset.uri); setImageError(false); setUploadPercent(0);
    try {
      const formData = new FormData();
      const filePart = buildFilePart(asset);
      if (Platform.OS === 'web') { const res = await fetch(asset.uri); const blob = await res.blob(); formData.append('file', blob, filePart.name); } 
      else { formData.append('file', filePart); }
      const updateRes = await uploadMultipart(API_ROUTES.USERS.UPDATE_DP, formData, setUploadPercent);
      const newAvatarUrl = updateRes?.avatarUrl || updateRes?.profilePictureUrl || updateRes?.url;
      if (newAvatarUrl) {
        setAvatarUri(newAvatarUrl);
        await AsyncStorage.setItem('@user_avatar', newAvatarUrl);
        if (currentUsername) await invalidateAvatar(currentUsername);
      }
      Toast.show({ type: 'success', text1: 'Success', text2: 'Profile picture updated globally.' });
    } catch (e: any) { 
      setAvatarUri(previousAvatar);
      Toast.show({ type: 'error', text1: 'Upload Failed', text2: e.message || "Could not update profile picture." }); 
    } 
    finally { setUploadPercent(null); }
  };

  const confirmDeletePost = async () => {
    const postId = deleteModal.targetId;
    setDeleteModal({ visible: false, targetId: null });
    try {
      await apiClient.delete(API_ROUTES.POSTS.DELETE(postId));
      setUserPosts(current => current.filter(post => String(post.id) !== String(postId)));
      Toast.show({ type: 'success', text1: 'Success', text2: 'Post permanently deleted.' });
    } catch (e: any) { Toast.show({ type: 'error', text1: 'Delete Failed', text2: e.message || "An unknown network error occurred." }); }
  };

  const getFullAvatarUrl = (uri: string | null) => {
    if (!uri) return null;
    if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('file://')) return uri;
    return `${BASE_URL.replace(/\/$/, '')}${uri.startsWith('/') ? uri : `/${uri}`}`;
  };

  const fullAvatarUrl = getFullAvatarUrl(avatarUri);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topNav}>
        <TouchableOpacity onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}>
          <Text style={styles.brandTitle}>WarnPack</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.iconButton} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="settings" size={20} color={colors.text} /></TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={userPosts}
        keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} 
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.text} />}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        ListHeaderComponent={
          <View style={styles.profileHeaderContainer}>
            <View style={styles.avatarWrapper}>
              <View style={styles.avatarGlow}>
                {fullAvatarUrl && !imageError ? (
                  <Image source={{ uri: fullAvatarUrl, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.avatarImage} onError={() => setImageError(true)} />
                ) : (
                  <Feather name="user" size={48} color={colors.textMuted} />
                )}
              </View>
              <TouchableOpacity style={styles.cameraBadge} onPress={handleEditProfileDP} disabled={uploadPercent !== null}>
                <Ionicons name="camera" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>
            {uploadPercent !== null && <Text style={styles.uploadText}>Uploading {uploadPercent}%</Text>}
            <View style={styles.identityContainer}><Text style={styles.usernameText}>@{currentUsername}</Text></View>
            <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>MY POSTS</Text></View>
          </View>
        }
        renderItem={({ item }) => <PostCard post={item} currentUsername={currentUsername} onDelete={() => setDeleteModal({ visible: true, targetId: item.id })} isVisible={visiblePosts.includes(String(item.id)) && !menuVisible && isFocused} onCommentTap={() => navigation.navigate('SinglePost', { postId: item.id })} />}
        ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 30 }}>No posts yet.</Text>}
      />

      <Modal visible={menuVisible} animationType="slide" transparent={true} onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setMenuVisible(false)} />
          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={styles.menuSectionHeader}>PREFERENCES</Text>
            
            <View style={styles.menuItemRow}>
              <Text style={styles.menuText}>Dark Theme</Text>
              <Switch value={isDarkMode} onValueChange={toggleTheme} trackColor={{ false: colors.border, true: colors.primary }} />
            </View>
            
            <TouchableOpacity style={styles.menuItemRow} onPress={() => { setMenuVisible(false); navigation.navigate('PremiumUpgrade'); }}>
              <Text style={[styles.menuText, { color: '#FBBF24', fontWeight: 'bold' }]}>✨ Upgrade to Premium</Text>
              <Feather name="chevron-right" size={18} color="#FBBF24" />
            </TouchableOpacity>

            {/* 🟢 Maintained your support & help links here */}
            <Text style={[styles.menuSectionHeader, { marginTop: 16 }]}>SUPPORT & HELP</Text>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => Linking.openURL('https://viacustos.github.io/publicinfo/')}>
              <Text style={styles.menuText}>Report a Bug</Text>
              <Feather name="external-link" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => Linking.openURL('https://viacustos.github.io/publicinfo/')}>
              <Text style={styles.menuText}>Suggest a Feature</Text>
              <Feather name="external-link" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => Linking.openURL('https://viacustos.github.io/publicinfo/')}>
              <Text style={styles.menuText}>Help & FAQ</Text>
              <Feather name="help-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => { setMenuVisible(false); navigation.navigate('BlockedUsers'); }}>
              <Text style={styles.menuText}>Blocked Users</Text>
              <Feather name="shield" size={16} color={colors.textMuted} />
            </TouchableOpacity>

            <Text style={[styles.menuSectionHeader, { marginTop: 16 }]}>LEGAL</Text>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => Linking.openURL('https://viacustos.github.io/publicinfo/')}><Text style={styles.menuText}>Terms of Service</Text></TouchableOpacity>
            <TouchableOpacity style={styles.menuItemRow} onPress={() => Linking.openURL('https://viacustos.github.io/publicinfo/')}><Text style={styles.menuText}>Privacy Policy</Text></TouchableOpacity>

            <TouchableOpacity style={[styles.menuItemRow, { marginTop: 20 }]} onPress={handleLogout}>
              <Feather name="log-out" size={18} color={colors.danger} /><Text style={[styles.menuText, { color: colors.danger, marginLeft: 10 }]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 🟢 NEW: Custom Sleek Confirm Modal for Delete */}
      <Modal visible={deleteModal.visible} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setDeleteModal({ ...deleteModal, visible: false })} />
          <View style={[styles.confirmModalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={[styles.confirmMessage, { color: colors.text }]}>Permanently delete this post?</Text>
            <TouchableOpacity style={styles.actionBtnDestructive} onPress={confirmDeletePost}>
              <Text style={styles.actionBtnText}>Delete Post</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtnCancel, { borderColor: colors.border }]} onPress={() => setDeleteModal({ ...deleteModal, visible: false })}>
              <Text style={[styles.actionBtnText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, backgroundColor: colors.background },
  brandTitle: { color: colors.text, fontSize: 18, fontWeight: '900', letterSpacing: 1 },
  iconButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  profileHeaderContainer: { alignItems: 'center', paddingTop: 10, paddingHorizontal: 20 },
  avatarWrapper: { position: 'relative', marginBottom: 15 },
  avatarGlow: { width: 104, height: 104, borderRadius: 52, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surface, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  cameraBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: colors.primary, width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: colors.background, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 4 },
  uploadText: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 10, letterSpacing: 1 },
  identityContainer: { alignItems: 'center', marginBottom: 20 },
  usernameText: { color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: 0.5, marginBottom: 6 },
  sectionHeader: { alignSelf: 'flex-start', marginBottom: 15, marginTop: 20 },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderWidth: 1, borderColor: colors.border },
  menuSectionHeader: { color: colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  menuItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  menuText: { fontSize: 14, fontWeight: '700', color: colors.text },
  // Modal Styles
  confirmModalContent: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  confirmMessage: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 24 },
  actionBtnDestructive: { backgroundColor: colors.danger, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  actionBtnCancel: { paddingVertical: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  actionBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 }
});