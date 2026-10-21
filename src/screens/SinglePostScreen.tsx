import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, ActivityIndicator, Text, FlatList, TextInput, KeyboardAvoidingView, Platform, Image, Keyboard, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { apiClient, API_ROUTES, BASE_URL } from '../services/api';
import PostCard from '../components/PostCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext'; 

export default function SinglePostScreen({ route }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
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
  const [actionModal, setActionModal] = useState({ visible: false, targetId: null as any, type: '', message: '' });

  // 🟢 FIX: Exactly like GossipsChatScreen, only track manual keyboard height on Android
  useEffect(() => {
    if (Platform.OS === 'android') {
      const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
      const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
      return () => { showSub.remove(); hideSub.remove(); };
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem('@active_username').then(user => { if (user) setActiveUser(user.toLowerCase()); });
    AsyncStorage.getItem('@ghost_token').then(setAuthToken);
    if (postId) fetchPostAndComments();
  }, [postId]);

  const fetchPostAndComments = async () => {
    try {
      const postResponse = await apiClient.get(API_ROUTES.POSTS.GET_SINGLE(postId));
      setPost(postResponse);
      const commentsResponse = await apiClient.get(API_ROUTES.POSTS.GET_COMMENTS(postId, Date.now()));
      setComments(commentsResponse || []);
    } catch (err) { setError("This post may have been deleted."); } finally { setIsLoading(false); }
  };

  const handleSendComment = async () => {
    if (!commentInput.trim()) return;
    setIsSending(true);
    try {
      await apiClient.post(API_ROUTES.POSTS.CREATE_COMMENT(postId), { content: commentInput.trim(), parentId: replyingTo ? replyingTo.id : null });
      setCommentInput(''); setReplyingTo(null);
      await fetchPostAndComments();
    } catch (err) { } finally { setIsSending(false); }
  };

  const executeAction = async () => {
    const { targetId, type } = actionModal;
    setActionModal({ ...actionModal, visible: false });
    try {
      if (type === 'DELETE') {
        await apiClient.delete(API_ROUTES.POSTS.DELETE_COMMENT(targetId));
        setComments(prev => prev.filter(c => c.id !== targetId && c.parentId !== targetId));
        setPost((p: any) => ({ ...p, commentCount: Math.max(0, (p.commentCount || 1) - 1) }));
      } else if (type === 'REPORT') {
        await apiClient.post(API_ROUTES.MODERATION.REPORT, { targetId, type: 'COMMENT_REPORT' });
        setComments(prev => prev.filter(c => c.id !== targetId && c.parentId !== targetId));
      }
    } catch (e) { }
  };

  const handleBackNavigation = () => { if (navigation.canGoBack()) navigation.goBack(); else navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] }); };

  const renderComment = ({ item }: { item: any }) => {
    const isReply = item.parentId !== null;
    const rawAvatar = item.avatarUrl || item.profilePictureUrl || item.profile?.avatarUrl;
    const avatarUri = rawAvatar ? (rawAvatar.startsWith('http') ? rawAvatar : `${BASE_URL}${rawAvatar}`) : null;
    const cleanAuthor = item.username?.toLowerCase() || '';
    const isMyComment = cleanAuthor === activeUser;

    return (
      <View style={[styles.commentRow, isReply && styles.replyNode]}>
        <TouchableOpacity onPress={() => navigation.navigate('PublicProfile', { targetUser: cleanAuthor })}>
          {avatarUri ? <Image source={{ uri: avatarUri, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.commentAvatar} /> : <View style={[styles.commentAvatar, { backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center' }]}><Text style={{ color: colors.text, fontWeight: 'bold' }}>{cleanAuthor[0]?.toUpperCase()}</Text></View>}
        </TouchableOpacity>
        <View style={styles.commentContent}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={styles.commentUsername}>@{cleanAuthor}</Text>
            {isMyComment ? (
               <TouchableOpacity onPress={() => setActionModal({ visible: true, targetId: item.id, type: 'DELETE', message: 'Delete this comment permanently?' })} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="trash-2" size={14} color={colors.danger}/></TouchableOpacity>
            ) : (
               <TouchableOpacity onPress={() => setActionModal({ visible: true, targetId: item.id, type: 'REPORT', message: 'Flag this comment for review?' })} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="flag" size={12} color={colors.textMuted}/></TouchableOpacity>
            )}
          </View>
          <Text style={styles.commentText}>{item.content}</Text>
          <TouchableOpacity style={{ marginTop: 6 }} onPress={() => { setReplyingTo(item); inputRef.current?.focus(); }}>
            <Text style={styles.replyBtnText}>Reply</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // 🟢 FIX: Packaged the scrollview and input perfectly inside a variable for OS-specific wrapping
  const screenContent = (
    <>
      <View style={styles.content}>
        {isLoading ? <ActivityIndicator size="large" color={colors.textMuted} style={{ marginTop: 50 }} /> : error || !post ? (
          <View style={styles.errorContainer}><Feather name="alert-circle" size={40} color={colors.textMuted} /><Text style={styles.errorText}>{error || "Post not found"}</Text></View>
        ) : (
          <FlatList
            ref={flatListRef} data={comments} keyExtractor={(item) => item.id.toString()} 
            contentContainerStyle={{ paddingBottom: 20 }} 
            keyboardShouldPersistTaps="handled"
            renderItem={renderComment}
            ListHeaderComponent={
              <View style={styles.postWrapper}>
                <PostCard post={post} currentUsername={activeUser} isVisible={isFocused} disableCommentAction={true} onUserTap={() => navigation.navigate('PublicProfile', { targetUser: post.username })} />
                <View style={styles.commentsDivider}><Text style={styles.commentsHeader}>COMMENTS ({post.commentCount || 0})</Text></View>
              </View>
            }
            ListEmptyComponent={<Text style={styles.emptyComments}>No comments yet. Be the first!</Text>}
          />
        )}
      </View>

      {!isLoading && !error && post && (
        <View style={{ backgroundColor: colors.background }}>
          {replyingTo && (
            <View style={styles.replyingIndicator}>
              <Text style={styles.replyingText}>Replying to @{replyingTo.username}</Text>
              <TouchableOpacity onPress={() => setReplyingTo(null)}><Feather name="x" size={16} color={colors.text} /></TouchableOpacity>
            </View>
          )}
          
          <View style={[styles.composerContainer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TextInput ref={inputRef} style={styles.commentInput} placeholder="Add a comment..." placeholderTextColor={colors.textMuted} value={commentInput} onChangeText={setCommentInput} multiline maxLength={200} />
            <TouchableOpacity style={[styles.sendBtn, (!commentInput.trim() || isSending) && { opacity: 0.5 }]} onPress={handleSendComment} disabled={!commentInput.trim() || isSending}>
              {isSending ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ color: colors.primary, fontWeight: '700' }}>Post</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );

  return (
    // 🟢 FIX: Replaced SafeAreaView with standard View + insets padding, mimicking GossipsChatScreen perfectly
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topNav}>
       <TouchableOpacity onPress={handleBackNavigation} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="arrow-left" size={24} color={colors.text} /></TouchableOpacity>
        <TouchableOpacity onPress={() => flatListRef.current?.scrollToOffset({ offset: 0, animated: true })}><Text style={styles.brandTitle}>POST</Text></TouchableOpacity>
        <View style={{ width: 24 }} />
      </View>

      {/* 🟢 FIX: Exact iOS/Android split you used successfully in GossipsChatScreen */}
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          {screenContent}
        </KeyboardAvoidingView>
      ) : (
        <View style={{ flex: 1, paddingBottom: keyboardHeight }}>
          {screenContent}
        </View>
      )}

      <Modal visible={actionModal.visible} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => setActionModal({ ...actionModal, visible: false })} />
          <View style={[styles.confirmModalContent, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={[styles.confirmMessage, { color: colors.text }]}>{actionModal.message}</Text>
            <TouchableOpacity style={styles.actionBtnDestructive} onPress={executeAction}>
              <Text style={styles.actionBtnText}>{actionModal.type === 'DELETE' ? 'Delete' : 'Report'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtnCancel, { borderColor: colors.border }]} onPress={() => setActionModal({ ...actionModal, visible: false })}>
              <Text style={[styles.actionBtnText, { color: colors.text }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (colors: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, backgroundColor: colors.background },
  brandTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  content: { flex: 1 },
  postWrapper: { marginBottom: 0 },
  errorContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  errorText: { color: colors.textMuted, fontSize: 15, textAlign: 'center', marginTop: 16, fontWeight: '600' },
  commentsDivider: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  commentsHeader: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  emptyComments: { color: colors.textMuted, textAlign: 'center', marginTop: 20, fontSize: 14 },
  commentRow: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 16 },
  replyNode: { paddingLeft: 48 },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, marginRight: 12 },
  commentContent: { flex: 1 },
  commentUsername: { color: colors.textMuted, fontSize: 13, fontWeight: '700', marginBottom: 2 },
  commentText: { color: colors.text, fontSize: 14, lineHeight: 18 },
  replyBtnText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  replyingIndicator: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.surface },
  replyingText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  composerContainer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 12, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  commentInput: { flex: 1, color: colors.text, fontSize: 14, minHeight: 36, maxHeight: 100, marginRight: 12 },
  sendBtn: { justifyContent: 'center', alignItems: 'center', paddingBottom: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  confirmModalContent: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  confirmMessage: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 24 },
  actionBtnDestructive: { backgroundColor: colors.danger, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  actionBtnCancel: { paddingVertical: 16, borderRadius: 12, alignItems: 'center', borderWidth: 1 },
  actionBtnText: { color: '#FFF', fontWeight: '800', fontSize: 15 }
});