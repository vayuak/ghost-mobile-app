import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator, Text, FlatList, TextInput, KeyboardAvoidingView, Platform, Image, Keyboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { apiClient, API_ROUTES, BASE_URL } from '../services/api';
import PostCard from '../components/PostCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext'; 

export default function SinglePostScreen({ route }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  
  const navigation = useNavigation<any>();
  const { postId } = route.params;
  const isFocused = useIsFocused();
  const flatListRef = useRef<FlatList>(null);
  
  const [post, setPost] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const inputRef = useRef<TextInput>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeUser, setActiveUser] = useState('');
  const [authToken, setAuthToken] = useState<string | null>(null);
  
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
      const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
      return () => { showSub.remove(); hideSub.remove(); };
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('@active_username').then(user => { if (user) setActiveUser(user); });
    AsyncStorage.getItem('@ghost_token').then(token => setAuthToken(token));
  }, []);

  const fetchPostAndComments = async () => {
    try {
      const postResponse = await apiClient.get(API_ROUTES.POSTS.GET_SINGLE(postId));
      setPost(postResponse);
      const commentsResponse = await apiClient.get(API_ROUTES.POSTS.GET_COMMENTS(postId, Date.now()));
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
      await apiClient.post(API_ROUTES.POSTS.CREATE_COMMENT(postId), {
        content: commentInput.trim(),
        parentId: replyingTo ? replyingTo.id : null 
      });
      setCommentInput('');
      setReplyingTo(null);
      await fetchPostAndComments();
    } catch (err: any) {
      alert(err.message || 'Failed to post comment.');
    } finally {
      setIsSending(false);
    }
  };

  const handleBackNavigation = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
  };

  const getFullAvatarUrl = (uri: string | null) => {
    if (!uri) return null;
    if (uri.startsWith('http')) return uri;
    return `${BASE_URL.replace(/\/$/, '')}${uri.startsWith('/') ? uri : `/${uri}`}`;
  };

  const renderComment = ({ item }: { item: any }) => {
    const isReply = item.parentId !== null;
    // 🟢 FIX: Handle deep JSON parsing for DPs safely
    const rawAvatar = item.avatarUrl || item.profilePictureUrl || item.profile?.avatarUrl;
    const avatarUri = getFullAvatarUrl(rawAvatar);

    return (
      <View style={[styles.commentRow, isReply && styles.replyNode]}>
        <TouchableOpacity style={styles.commentAvatar} onPress={() => navigation.navigate('PublicProfile', { targetUser: item.username })}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.commentAvatarImg} />
          ) : (
            <Text style={styles.commentAvatarLetter}>{item.username ? item.username[0].toUpperCase() : '?'}</Text>
          )}
        </TouchableOpacity>
        <View style={styles.commentBubble}>
          <TouchableOpacity onPress={() => navigation.navigate('PublicProfile', { targetUser: item.username })}>
            <Text style={styles.commentUsername}>@{item.username}</Text>
          </TouchableOpacity>
          <Text style={styles.commentText}>{item.content}</Text>
          <TouchableOpacity style={{ marginTop: 8 }} onPress={() => { setReplyingTo(item); inputRef.current?.focus(); }}>
            <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: '800' }}>REPLY</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const screenContent = (
    <>
      <View style={styles.topNav}>
       <TouchableOpacity onPress={handleBackNavigation} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <Feather name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}>
          <Text style={styles.brandTitle}>POST</Text>
        </TouchableOpacity>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.textMuted} style={{ marginTop: 50 }} />
        ) : error || !post ? (
          <View style={styles.errorContainer}>
            <Feather name="alert-circle" size={40} color={colors.textMuted} />
            <Text style={styles.errorText}>{error || "Post not found"}</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={comments}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={{ paddingBottom: 20 }}
            keyboardShouldPersistTaps="handled"
            renderItem={renderComment}
            ListHeaderComponent={
              <View style={styles.postWrapper}>
                <PostCard post={post} currentUsername={activeUser} isVisible={isFocused} onUserTap={() => navigation.navigate('PublicProfile', { targetUser: post.username })} onCommentTap={() => inputRef.current?.focus()} />
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
        <View>
          {replyingTo && (
            <View style={styles.replyingIndicator}>
              <Text style={styles.replyingText}>Replying to @{replyingTo.username}</Text>
              <TouchableOpacity onPress={() => setReplyingTo(null)}><Feather name="x-circle" size={16} color={colors.textMuted} /></TouchableOpacity>
            </View>
          )}
          <View style={styles.composerContainer}>
            <TextInput
              ref={inputRef}
              style={styles.commentInput}
              placeholder="Write a comment..."
              placeholderTextColor={colors.textMuted}
              value={commentInput}
              onChangeText={setCommentInput}
              multiline
              maxLength={200}
            />
            <TouchableOpacity style={[styles.sendBtn, (!commentInput.trim() || isSending) && styles.sendBtnDisabled]} onPress={handleSendComment} disabled={!commentInput.trim() || isSending}>
              {isSending ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="send" size={18} color={commentInput.trim() ? '#FFF' : colors.textMuted} />}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
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

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: colors.border },
  brandTitle: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  content: { flex: 1 },
  postWrapper: { marginBottom: 10 },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  errorText: { color: colors.textMuted, fontSize: 15, textAlign: 'center', marginTop: 16, fontWeight: '600' },
  commentsDivider: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 8 },
  commentsHeader: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  emptyComments: { color: colors.textMuted, textAlign: 'center', marginTop: 20, fontSize: 14 },
  commentRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16 },
  replyNode: { paddingLeft: 44, borderLeftWidth: 2, borderColor: colors.border },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginRight: 10, overflow: 'hidden' },
  commentAvatarImg: { width: '100%', height: '100%' },
  commentAvatarLetter: { color: colors.text, fontSize: 14, fontWeight: 'bold' },
  commentBubble: { flex: 1, backgroundColor: colors.surface, padding: 12, borderRadius: 12 },
  commentUsername: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 4 },
  commentText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  replyingIndicator: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  replyingText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  composerContainer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  commentInput: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: 20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 14, minHeight: 40, maxHeight: 100, borderWidth: 1, borderColor: colors.border },
  sendBtn: { backgroundColor: colors.primary, width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  sendBtnDisabled: { backgroundColor: colors.surface }
});