import React, { useState, useEffect } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator, Text, FlatList, TextInput, KeyboardAvoidingView, Platform, Image, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { apiClient, API_ROUTES, BASE_URL } from '../services/api';
import PostCard from '../components/PostCard';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SinglePostScreen({ route, navigation }: any) {
  const { postId } = route.params;
  
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentInput, setCommentInput] = useState('');
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeUser, setActiveUser] = useState('');
  
  // 🟢 Manual Android Keyboard Measurement
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const showSubscription = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
      const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
      return () => {
        showSubscription.remove();
        hideSubscription.remove();
      };
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('@active_username').then(user => {
      if (user) setActiveUser(user);
    });
  }, []);

  const fetchPostAndComments = async () => {
    try {
      const postResponse = await apiClient.get(API_ROUTES.POST.GET_SINGLE(postId));
      setPost(postResponse);
      const commentsResponse = await apiClient.get(API_ROUTES.POST.GET_COMMENTS(postId, Date.now()));
      setComments(commentsResponse || []);
    } catch (err: any) {
      setError("This post may have been deleted or is unavailable.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (postId) fetchPostAndComments();
  }, [postId]);

  const handleSendComment = async () => {
    if (!commentInput.trim()) return;
    
    setIsSending(true);
    try {
      await apiClient.post(API_ROUTES.POST.CREATE_COMMENT(postId), {
        content: commentInput.trim(),
        parentId: null 
      });
      
      setCommentInput('');
      const commentsResponse = await apiClient.get(API_ROUTES.POST.GET_COMMENTS(postId, Date.now()));
      setComments(commentsResponse || []);
      setPost((prev: any) => ({ ...prev, commentCount: (prev.commentCount || 0) + 1 }));
    } catch (err: any) {
      alert(err.message || 'Failed to post comment.');
    } finally {
      setIsSending(false);
    }
  };

  const getFullAvatarUrl = (uri: string | null) => {
    if (!uri) return null;
    if (uri.startsWith('http')) return uri;
    return `${BASE_URL.replace(/\/$/, '')}${uri.startsWith('/') ? uri : `/${uri}`}`;
  };

  const renderComment = ({ item }: { item: any }) => {
    const avatarUri = getFullAvatarUrl(item.avatarUrl);

    return (
      <View style={styles.commentRow}>
        <TouchableOpacity 
          style={styles.commentAvatar} 
          onPress={() => navigation.navigate('PublicProfile', { targetUser: item.username })}
        >
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.commentAvatarImg} />
          ) : (
            <Text style={styles.commentAvatarLetter}>{item.username ? item.username[0].toUpperCase() : '?'}</Text>
          )}
        </TouchableOpacity>
        <View style={styles.commentBubble}>
          <TouchableOpacity onPress={() => navigation.navigate('PublicProfile', { targetUser: item.username })}>
            <Text style={styles.commentUsername}>@{item.username}</Text>
          </TouchableOpacity>
          <Text style={styles.commentText}>{item.content}</Text>
        </View>
      </View>
    );
  };

  const screenContent = (
    <>
      <View style={styles.topNav}>
       <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('MainTabs', { screen: 'Home' })} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
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
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={{ paddingBottom: 20 }}
            renderItem={renderComment}
            ListHeaderComponent={
              <View style={styles.postWrapper}>
                <PostCard 
                  post={post} 
                  currentUsername={activeUser} 
                  onUserTap={() => navigation.navigate('PublicProfile', { targetUser: post.username })}
                />
                <View style={styles.commentsDivider}>
                  <Text style={styles.commentsHeader}>COMMENTS ({post.commentCount || 0})</Text>
                </View>
              </View>
            }
            ListEmptyComponent={<Text style={styles.emptyComments}>No comments yet. Be the first!</Text>}
          />
        )}
      </View>

      {!isLoading && !error && post && (
        <View style={styles.composerContainer}>
          <TextInput
            style={styles.commentInput}
            placeholder="Write a comment..."
            placeholderTextColor="#666"
            value={commentInput}
            onChangeText={setCommentInput}
            multiline
            maxLength={200}
          />
          <TouchableOpacity 
            style={[styles.sendBtn, (!commentInput.trim() || isSending) && styles.sendBtnDisabled]} 
            onPress={handleSendComment}
            disabled={!commentInput.trim() || isSending}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Feather name="send" size={18} color={commentInput.trim() ? '#FFF' : '#666'} />
            )}
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 🟢 Platform-Specific Keyboard Wrapper */}
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {screenContent}
        </KeyboardAvoidingView>
      ) : (
        <View style={{ flex: 1, paddingBottom: keyboardHeight }}>
          {screenContent}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  brandTitle: { color: '#FFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  content: { flex: 1 },
  postWrapper: { marginBottom: 10 },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  errorText: { color: '#666', fontSize: 15, textAlign: 'center', marginTop: 16, fontWeight: '600' },
  commentsDivider: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#1A1A1A', marginTop: 8 },
  commentsHeader: { color: '#666', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  emptyComments: { color: '#666', textAlign: 'center', marginTop: 20, fontSize: 14 },
  commentRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 10, overflow: 'hidden' },
  commentAvatarImg: { width: '100%', height: '100%' },
  commentAvatarLetter: { color: '#FFF', fontSize: 14, fontWeight: 'bold' },
  commentBubble: { flex: 1, backgroundColor: '#1A1A1A', padding: 12, borderRadius: 12 },
  commentUsername: { color: '#A3A3A3', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  commentText: { color: '#FFF', fontSize: 14, lineHeight: 20 },
  composerContainer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#0A0A0A', borderTopWidth: 1, borderTopColor: '#1A1A1A' },
  commentInput: { flex: 1, backgroundColor: '#1A1A1A', color: '#FFF', borderRadius: 20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 14, minHeight: 40, maxHeight: 100, borderWidth: 1, borderColor: '#262626' },
  sendBtn: { backgroundColor: '#333', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  sendBtnDisabled: { backgroundColor: '#1A1A1A' }
});