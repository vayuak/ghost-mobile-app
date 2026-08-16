import React, { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, View, TouchableOpacity, FlatList, Image, Modal, Alert, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, BASE_URL, systemLogout } from '../services/api';
import PostCard from '../components/PostCard'; 

export default function ProfileScreen({ navigation, onLogoutTrigger }: any) {
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string>('loading...'); 

  useEffect(() => {
    const loadSessionData = async () => {
      const token = await AsyncStorage.getItem('@ghost_token');
      setAuthToken(token);
      
      if (token) {
        try {
          const response = await apiClient.get('/v1/auth/me');
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
      const res = await apiClient.get(`/v1/social/post/my-posts`);
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
      mediaTypes: ImagePicker.MediaTypeOptions.Images, 
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      setAvatarUri(asset.uri); 

      try {
        const formData = new FormData();
        const filename = asset.uri.split('/').pop() || 'profile.jpg';
        const type = asset.mimeType || 'image/jpeg';

        if (Platform.OS === 'web') {
          const res = await fetch(asset.uri);
          const blob = await res.blob();
          formData.append('file', blob, filename);
        } else {
          // 🟢 FIX: Pass asset.uri directly without string manipulation
          formData.append('file', {
            uri: asset.uri,
            name: filename,
            type: type
          } as any);
        }

        const uploadResponse = await fetch(`${BASE_URL}/v1/social/user/profile/upload-and-update`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${authToken}`
          },
          body: formData,
        });

        if (!uploadResponse.ok) throw new Error('Upload request failed.');
        
        const updateRes = await uploadResponse.json();
        if (updateRes?.avatarUrl) {
            setAvatarUri(updateRes.avatarUrl);
            await AsyncStorage.setItem('@user_avatar', updateRes.avatarUrl);
        }
        Alert.alert("Success", "Profile picture updated globally.");
      } catch (e: any) {
        Alert.alert("Upload Failed", e.message || "Could not update profile picture.");
      }
    }
  };

  const handleDeletePost = async (postId: any) => {
    try {
      const token = await AsyncStorage.getItem('@ghost_token');
      
      const response = await fetch(`${BASE_URL}/v1/social/post/${postId}/delete`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `Server failed with status ${response.status}`);
      }

      setUserPosts(current => current.filter(post => String(post.id) !== String(postId)));
      Alert.alert("Success", "Post permanently deleted.");
      
    } catch (e: any) {
      Alert.alert("Delete Failed", e.message || "An unknown network error occurred.");
    }
  };

  const fullAvatarUrl = avatarUri?.startsWith('http') || avatarUri?.startsWith('file://') || avatarUri?.startsWith('data:')
    ? avatarUri 
    : `${BASE_URL}${avatarUri}`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topNav}>
        <Text style={styles.brandTitle}>GHOST<Text style={{ color: '#8E95A5' }}>SHIELD</Text></Text>
        <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.iconButton}>
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
                {avatarUri ? (
                  <Image source={{ uri: fullAvatarUrl, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.avatarImage} />
                ) : (
                  <Feather name="user" size={48} color="#4A5060" />
                )}
              </View>
              <TouchableOpacity style={styles.cameraBadge} onPress={handleEditProfileDP}>
                <Ionicons name="camera" size={14} color="#FFF" />
              </TouchableOpacity>
            </View>

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

      <Modal visible={menuVisible} animationType="slide" transparent={true}>
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
  identityContainer: { alignItems: 'center', marginBottom: 20 },
  usernameText: { color: '#FFF', fontSize: 22, fontWeight: '800', letterSpacing: 0.5, marginBottom: 6 },
  sectionHeader: { alignSelf: 'flex-start', marginBottom: 15, marginTop: 20 },
  sectionTitle: { color: '#666666', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, borderWidth: 1, borderColor: '#262626' },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  menuText: { fontSize: 15, fontWeight: '700', marginLeft: 14 }
});