import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, BASE_URL } from '../services/api';
import { Feather } from '@expo/vector-icons';

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

  useEffect(() => {
    fetchComments();
    if (!propUsername) {
      AsyncStorage.getItem('@active_username').then(user => {
        if (user) setLocalUsername(user);
      });
    }
  }, [propUsername]);

  const activeUser = propUsername || localUsername;

  const fetchComments = async () => {
    try {
      const response = await apiClient.get(`/v1/social/post/${postId}/comments?t=${new Date().getTime()}`);
      setComments(response.data || response); 
    } catch (error) {
      console.error("Failed to load comments", error);
    } finally {
      setLoading(false);
    }
  };

  const handlePostComment = async () => {
    if (!newComment.trim()) return;
    try {
      const payload = {
        content: newComment.trim(),
        parentId: replyingTo ? replyingTo.id : null
      };
      
      await apiClient.post(`/v1/social/post/${postId}/comment`, payload);
      setNewComment('');
      setReplyingTo(null);
      fetchComments(); 
      onCommentAdded(); 
    } catch (error: any) {
      const msg = error.response?.data?.error || error.message || "Failed to post comment";
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert("Error", msg);
      }
    }
  };

  const executeDelete = async (commentId: number) => {
    try {
      await apiClient.delete(`/v1/social/post/comment/${commentId}`);
      // Optimistically clear from local state instantly
      setComments(current => current.filter(c => String(c.id) !== String(commentId)));
      onCommentDeleted(); 
    } catch (error: any) {
      const msg = error.response?.data?.error || error.message || "Failed to delete comment";
      if (Platform.OS === 'web') {
        window.alert("Error: " + msg);
      } else {
        Alert.alert("Error", msg);
      }
    }
  };

  const handleDeleteComment = (commentId: number) => {
    // 🟢 Platform check to guarantee deletion triggers on both web and native platforms
    if (Platform.OS === 'web') {
      if (window.confirm("Are you sure you want to delete this comment?")) {
        executeDelete(commentId);
      }
    } else {
      Alert.alert("Delete Comment", "Are you sure you want to delete this comment?", [
        { text: "No", style: "cancel" },
        { 
          text: "Yes", 
          style: "destructive",
          onPress: () => executeDelete(commentId)
        }
      ]);
    }
  };

  const renderAvatar = (url: string | null, fallbackUsername: string) => {
    if (url) {
      const formattedUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
      return <Image source={{ uri: formattedUrl }} style={{ width: 28, height: 28, borderRadius: 14, marginRight: 10, backgroundColor: '#262626' }} />;
    }
    return (
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
        <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 12 }}>
          {fallbackUsername ? fallbackUsername[0]?.toUpperCase() : 'U'}
        </Text>
      </View>
    );
  };

  const renderComment = ({ item }: { item: Comment }) => {
    const isReply = item.parentId !== null;
    const isOwner = activeUser && item.username && activeUser.trim().toLowerCase() === item.username.trim().toLowerCase();

    return (
      <View style={{ 
        marginLeft: isReply ? 32 : 16, 
        marginRight: 16, 
        marginTop: 16,
        paddingLeft: isReply ? 12 : 0, 
        borderLeftWidth: isReply ? 2 : 0, 
        borderColor: '#262626'
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {renderAvatar(item.avatarUrl, item.username)}
            <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14 }}>@{item.username}</Text>
          </View>
          
          {isOwner && (
            <TouchableOpacity onPress={() => handleDeleteComment(item.id)} style={{ padding: 6, backgroundColor: 'rgba(255, 59, 48, 0.1)', borderRadius: 6 }}>
              <Feather name="trash-2" size={15} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>

        <Text style={{ color: '#E0E0E0', marginTop: 8, fontSize: 14, paddingLeft: 38, lineHeight: 20 }}>
          {item.content}
        </Text>
        
        <TouchableOpacity style={{ marginTop: 8, paddingLeft: 38 }} onPress={() => setReplyingTo(item)}>
          <Text style={{ color: '#666666', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 }}>REPLY</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: '#121212' }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: '#262626', marginTop: Platform.OS === 'ios' ? 0 : 10 }}>
        <Text style={{ color: 'white', fontSize: 18, fontWeight: 'bold' }}>Comments</Text>
        <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
          <Feather name="x" size={24} color="white" />
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
          ListEmptyComponent={<Text style={{ color: '#666', textAlign: 'center', marginTop: 50 }}>No comments yet.</Text>}
        />
      )}

      <View style={{ padding: 16, borderTopWidth: 1, borderColor: '#262626', backgroundColor: '#000000' }}>
        {replyingTo && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: '#8E95A5', fontSize: 12 }}>Replying to @{replyingTo.username}</Text>
            <TouchableOpacity onPress={() => setReplyingTo(null)}>
              <Feather name="x-circle" size={16} color="#FF4444" />
            </TouchableOpacity>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TextInput
            value={newComment} 
            onChangeText={setNewComment}
            placeholder={replyingTo ? `Reply to @${replyingTo.username}...` : "Type a comment..."} 
            placeholderTextColor="#666666"
            style={{ flex: 1, color: 'white', backgroundColor: '#1A1A1A', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, maxHeight: 100, borderWidth: 1, borderColor: '#262626' }}
            multiline
          />
          <TouchableOpacity onPress={handlePostComment} style={{ marginLeft: 12, padding: 10, backgroundColor: newComment.trim() ? '#262626' : 'transparent', borderRadius: 20 }} disabled={!newComment.trim()}>
            <Feather name="send" size={18} color={newComment.trim() ? "#FFFFFF" : "#404040"} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}