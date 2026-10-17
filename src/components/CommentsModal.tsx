import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image, Keyboard } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message'; 
import { apiClient, BASE_URL, API_ROUTES } from '../services/api';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Comment {
  id: number;
  content: string;
  username: string;
  avatarUrl: string | null;
  parentId: number | null;
  createdAt: string;
}

interface CommentsModalProps {
  postId: number;
  currentUsername?: string;
  onClose: () => void;
  onCommentAdded: () => void;
  onCommentDeleted: () => void;
}

export default function CommentsModal({ postId, currentUsername: propUsername, onClose, onCommentAdded, onCommentDeleted }: CommentsModalProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const [loading, setLoading] = useState(true);
  const [localUsername, setLocalUsername] = useState<string | null>(propUsername || null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS === 'android') {
      const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
      const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
      return () => { showSub.remove(); hideSub.remove(); };
    }
  }, []);

  useEffect(() => {
    fetchComments();
    if (!propUsername) {
      AsyncStorage.getItem('@active_username').then(user => {
        if (user) setLocalUsername(user.replace(/^@/, '').trim().toLowerCase());
      });
    }
  }, [propUsername]);

  const activeUser = (propUsername || localUsername || '').replace(/^@/, '').trim().toLowerCase();

  const fetchComments = async () => {
    try {
      const response = await apiClient.get(API_ROUTES.POSTS.GET_COMMENTS(postId, new Date().getTime()));
      setComments(response.data || response || []); 
    } catch (error) {
      console.error("Failed to load comments", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    try {
      const payload = { content: newComment.trim(), parentId: replyingTo ? replyingTo.id : null };
      await apiClient.post(API_ROUTES.POSTS.CREATE_COMMENT(postId), payload);
      setNewComment('');
      setReplyingTo(null);
      Keyboard.dismiss(); // Cleanly drop keyboard on send
      fetchComments(); 
      onCommentAdded(); 
    } catch (error: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: "Failed to post comment" });
    }
  };

  const executeDelete = async (commentId: number) => {
    try {
      await apiClient.delete(API_ROUTES.COMMENTS.DELETE(commentId));
      setComments(current => current.filter(c => String(c.id) !== String(commentId)));
      onCommentDeleted(); 
    } catch (error: any) {
      Toast.show({ type: 'error', text1: 'Error', text2: "Failed to delete comment" });
    }
  };

  const handleDeleteComment = (commentId: number) => {
    Alert.alert("Delete", "Permanently delete this comment?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => executeDelete(commentId) }
    ], { cancelable: true });
  };

  const handleReportComment = (commentId: number, username: string) => {
    Alert.alert("Report Comment", "Flag this comment for community moderation?", [
      { text: "Cancel", style: "cancel" },
      { text: "Report", style: "destructive", onPress: () => {
          apiClient.post(API_ROUTES.MODERATION.REPORT, { targetId: commentId, type: 'COMMENT_REPORT', targetUser: username }).catch(()=>{});
          Toast.show({ type: 'success', text1: 'Reported', text2: 'Comment flagged for review.' });
      }}
    ], { cancelable: true });
  };

  const renderComment = ({ item }: { item: Comment }) => {
    const isReply = item.parentId !== null;
    const cleanCommentAuthor = (item.username || '').replace(/^@/, '').trim().toLowerCase();
    const isOwner = activeUser === cleanCommentAuthor;

    return (
      <View style={{ marginLeft: isReply ? 32 : 16, marginRight: 16, marginTop: 16, paddingLeft: isReply ? 12 : 0, borderLeftWidth: isReply ? 2 : 0, borderColor: '#262626' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
              <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 12 }}>{cleanCommentAuthor[0]?.toUpperCase()}</Text>
            </View>
            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>@{cleanCommentAuthor}</Text>
          </View>
          
          <View style={{ flexDirection: 'row' }}>
            {isOwner ? (
              <TouchableOpacity onPress={() => handleDeleteComment(item.id)} style={{ padding: 6 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="trash-2" size={15} color="#FF3B30" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => handleReportComment(item.id, cleanCommentAuthor)} style={{ padding: 6 }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Feather name="flag" size={14} color="#666" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={{ color: '#E0E0E0', marginTop: 8, fontSize: 14, paddingLeft: 38, lineHeight: 20 }}>{item.content}</Text>
        
        <TouchableOpacity style={{ marginTop: 8, paddingLeft: 38 }} onPress={() => setReplyingTo(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={{ color: '#666666', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>REPLY</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const modalContent = (
    <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: '#262626', marginTop: Platform.OS === 'ios' ? 0 : 10 }}>
        <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>Comments</Text>
        <TouchableOpacity onPress={onClose} style={{ padding: 4 }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <Feather name="chevron-down" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#fff" style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(item, index) => item.id?.toString() || index.toString()}
          renderItem={renderComment}
          contentContainerStyle={{ paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled" // 🟢 CRITICAL FIX: Allows the send button to be tapped while keyboard is open
          ListEmptyComponent={<Text style={{ color: '#666', textAlign: 'center', marginTop: 50 }}>No comments yet.</Text>}
        />
      )}

      <View style={{ padding: 16, borderTopWidth: 1, borderColor: '#262626', backgroundColor: '#000000', paddingBottom: Math.max(insets.bottom, 16) }}>
        {replyingTo && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: '#8E95A5', fontSize: 12 }}>Replying to @{replyingTo.username.replace(/^@/, '')}</Text>
            <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
              <Feather name="x-circle" size={16} color="#FF4444" />
            </TouchableOpacity>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            value={newComment} 
            onChangeText={setNewComment}
            placeholder={replyingTo ? `Reply to @${replyingTo.username.replace(/^@/, '')}...` : "Type a comment..."} 
            placeholderTextColor="#666666"
            style={{ flex: 1, color: 'white', backgroundColor: '#1A1A1A', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, maxHeight: 100, borderWidth: 1, borderColor: '#262626' }}
            multiline
          />
          <TouchableOpacity onPress={handlePostComment} style={{ marginLeft: 12, padding: 12, backgroundColor: newComment.trim() ? '#262626' : 'transparent', borderRadius: 20 }} disabled={!newComment.trim()}>
            <Feather name="send" size={18} color={newComment.trim() ? "#FFFFFF" : "#404040"} />
          </TouchableOpacity>
        </View>
      </View>
    </>
  );

  return Platform.OS === 'ios' ? (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#121212' }} behavior="padding">
      {modalContent}
    </KeyboardAvoidingView>
  ) : (
    // 🟢 CRITICAL FIX: Add margin bottom for Android so the input bar isn't eaten by the keyboard
    <View style={{ flex: 1, backgroundColor: '#121212', marginBottom: keyboardHeight }}>
      {modalContent}
    </View>
  );
}