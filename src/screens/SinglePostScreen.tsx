import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { apiClient, API_ROUTES } from '../services/api';
import PostCard from '../components/PostCard';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SinglePostScreen({ route, navigation }: any) {
  // Extract postId from the deep link route parameters
  const { postId } = route.params;
  
  const [post, setPost] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeUser, setActiveUser] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('@active_username').then(user => {
      if (user) setActiveUser(user);
    });
  }, []);

  useEffect(() => {
    const fetchSinglePost = async () => {
      try {
        const response = await apiClient.get(API_ROUTES.POST.GET_SINGLE(postId));
        setPost(response);
      } catch (err: any) {
        setError("This post may have been deleted or is unavailable.");
      } finally {
        setIsLoading(false);
      }
    };
    if (postId) fetchSinglePost();
  }, [postId]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topNav}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home')} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <Feather name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.brandTitle}>POST</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        {isLoading ? (
          <ActivityIndicator size="large" color="#666" style={{ marginTop: 50 }} />
        ) : error || !post ? (
          <View style={styles.errorContainer}>
            <Feather name="alert-circle" size={40} color="#666" />
            <Text style={styles.errorText}>{error || "Post not found"}</Text>
          </View>
        ) : (
          <PostCard 
            post={post} 
            currentUsername={activeUser} 
            onUserTap={() => navigation.navigate('PublicProfile', { targetUser: post.username })}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  brandTitle: { color: '#FFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  content: { flex: 1, paddingTop: 16 },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  errorText: { color: '#666', fontSize: 15, textAlign: 'center', marginTop: 16, fontWeight: '600' }
});