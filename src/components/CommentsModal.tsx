import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, Image, ActivityIndicator, Modal, Keyboard, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { apiClient, BASE_URL, API_ROUTES } from '../services/api';
import Toast from 'react-native-toast-message';
import { useTheme } from '../context/ThemeContext'; 

interface CommentsModalProps {
  visible: boolean;
  postId: string | number;
  currentUsername?: string;
  onClose: () => void;
  onCommentAdded?: () => void;
  onCommentDeleted?: () => void; 
}

export default function CommentsModal({ visible, postId, currentUsername, onClose, onCommentAdded, onCommentDeleted }: CommentsModalProps) {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  const navigation = useNavigation<any>(); 
  
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  
  const inputRef = useRef<TextInput>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'android') {
      const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
      const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
      return () => { showSub.remove(); hideSub.remove(); };
    }
  }, []);

  useEffect(() => {
    if (visible) { setLoading(true); fetchComments(); }
  }, [visible, postId]);

  const fetchComments = async () => {
    try {
      // Note: Adjust API_ROUTES.POSTS or POST based on your exact api.ts structure
      const data = await apiClient.get(API_ROUTES.POSTS.GET_COMMENTS(postId, Date.now()));
      setComments(data || []);
    } catch (error) { console.warn("Fetch failed"); } 
    finally { setLoading(false); }
  };

  const handleSend = async () => {
    const text = newComment.trim();
    if (!text || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await apiClient.post(API_ROUTES.POSTS.CREATE_COMMENT(postId), { content: text, parentId: replyingTo ? replyingTo.id : null });
      setNewComment('');
      setReplyingTo(null);
      if (onCommentAdded) onCommentAdded();
      await fetchComments(); 
    } catch (error: any) { Toast.show({ type: 'error', text1: 'Failed to post', text2: error.message }); } 
    finally { setIsSubmitting(false); }
  };

  const handleDeleteComment = (commentId: string | number) => {
    Alert.alert("Delete", "Delete this comment?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
          try {
            await apiClient.delete(API_ROUTES.POSTS.DELETE_COMMENT(commentId));
            setComments(prev => prev.filter(c => c.id !== commentId && c.parentId !== commentId));
            if (onCommentDeleted) onCommentDeleted();
          } catch (e) { Toast.show({ type: 'error', text1: 'Error', text2: 'Could not delete comment' }); }
      }}
    ]);
  };

  const handleReportComment = (commentId: string | number) => {
    Alert.alert("Report", "Flag this comment?", [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: async () => {
          try {
            await apiClient.post(API_ROUTES.MODERATION.REPORT, { targetId: commentId, type: 'COMMENT_REPORT' });
            setComments(prev => prev.filter(c => c.id !== commentId && c.parentId !== commentId));
            if (onCommentDeleted) onCommentDeleted();
            Toast.show({ type: 'success', text1: 'Reported', text2: 'Comment flagged for review.' });
          } catch (e) { Toast.show({ type: 'error', text1: 'Error', text2: 'Could not report comment' }); }
      }}
    ]);
  };

  const navigateToProfile = (username: string) => {
    onClose();
    setTimeout(() => { navigation.navigate('PublicProfile', { targetUser: username }); }, 300);
  };

  const getFullAvatarUrl = (uri: string | null) => {
    if (!uri) return null;
    if (uri.startsWith('http')) return uri;
    return `${BASE_URL.replace(/\/$/, '')}${uri.startsWith('/') ? uri : `/${uri}`}`;
  };

  const renderComment = ({ item }: { item: any }) => {
    const isReply = item.parentId !== null;
    const cleanAuthor = (item.username || '').replace(/^@/, '').trim().toLowerCase();
    
    const rawAvatar = item.avatarUrl || item.profilePictureUrl || item.profile?.avatarUrl;
    const avatarUri = getFullAvatarUrl(rawAvatar);

    return (
      <View style={[styles.commentNode, isReply && styles.replyNode]}>
        <View style={styles.commentHeader}>
          <TouchableOpacity style={styles.authorRow} onPress={() => navigateToProfile(cleanAuthor)}>
            {avatarUri ? <Image source={{ uri: avatarUri }} style={styles.avatarImage} /> : <View style={styles.avatarPlaceholder}><Text style={styles.avatarLetter}>{cleanAuthor[0]?.toUpperCase() || 'U'}</Text></View>}
            <Text style={styles.authorName}>@{cleanAuthor}</Text>
          </TouchableOpacity>
          
          {cleanAuthor === (currentUsername || '').replace(/^@/, '').trim().toLowerCase() ? (
             <TouchableOpacity onPress={() => handleDeleteComment(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
               <Feather name="trash-2" size={14} color={colors.danger}/>
             </TouchableOpacity>
          ) : (
             <TouchableOpacity onPress={() => handleReportComment(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
               <Feather name="flag" size={12} color={colors.textMuted}/>
             </TouchableOpacity>
          )}
        </View>
        <Text style={styles.commentContent}>{item.content}</Text>
        <TouchableOpacity style={styles.replyButton} onPress={() => { setReplyingTo(item); inputRef.current?.focus(); }}>
          <Text style={styles.replyText}>Reply</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView style={[styles.bottomSheetContainer, Platform.OS === 'android' && { paddingBottom: keyboardHeight }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheetHeader}>
            <Text style={styles.headerTitle}>Comments</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="x" size={24} color={colors.text} /></TouchableOpacity>
          </View>

          {loading ? <ActivityIndicator size="large" color={colors.textMuted} style={{ marginTop: 40 }} /> : (
            <FlatList data={comments} keyExtractor={(item) => item.id.toString()} renderItem={renderComment} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled" ListEmptyComponent={<Text style={styles.emptyText}>No comments yet.</Text>} />
          )}

          {replyingTo && (
            <View style={styles.replyingIndicator}>
              <Text style={styles.replyingText}>Replying to @{replyingTo.username}</Text>
              <TouchableOpacity onPress={() => setReplyingTo(null)}><Feather name="x-circle" size={16} color={colors.textMuted} /></TouchableOpacity>
            </View>
          )}

          <View style={styles.inputContainer}>
            <TextInput ref={inputRef} style={styles.input} placeholder="Add a comment..." placeholderTextColor={colors.textMuted} value={newComment} onChangeText={setNewComment} multiline maxLength={500} />
            <TouchableOpacity style={[styles.sendButton, !newComment.trim() && { opacity: 0.5 }]} onPress={handleSend} disabled={!newComment.trim() || isSubmitting}>
              {isSubmitting ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="arrow-up" size={20} color="#FFF" />}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const getStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
  modalOverlay: { flex: 1, backgroundColor: isDarkMode ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  bottomSheetContainer: { backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '80%', overflow: 'hidden' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  commentNode: { marginLeft: 16, marginRight: 16, marginTop: 16 },
  replyNode: { marginLeft: 44, paddingLeft: 12, borderLeftWidth: 2, borderColor: colors.surface }, 
  commentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  avatarImage: { width: 32, height: 32, borderRadius: 16, marginRight: 10, backgroundColor: colors.surface },
  avatarPlaceholder: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  avatarLetter: { color: colors.text, fontWeight: 'bold', fontSize: 13 },
  authorName: { color: colors.text, fontWeight: 'bold', fontSize: 13 },
  commentContent: { color: colors.text, marginTop: 4, fontSize: 14, paddingLeft: 42, lineHeight: 20 },
  replyButton: { marginTop: 6, paddingLeft: 42 },
  replyText: { color: colors.textMuted, fontSize: 11, fontWeight: '800' },
  emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },
  replyingIndicator: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface },
  replyingText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  inputContainer: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.background },
  input: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: 24, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 15, maxHeight: 100 },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
});