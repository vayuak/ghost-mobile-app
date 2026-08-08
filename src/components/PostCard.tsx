import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, Share, Alert, Modal, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, BASE_URL } from '../services/api';
import CommentsModal from './CommentsModal';

interface PostCardProps {
  post: any;
  currentUsername?: string;
  onDelete?: (postId: any) => void;
}

const parseNumeric = (val: any) => {
  if (typeof val === 'number') return val;
  if (Array.isArray(val)) return val.length; 
  if (!val) return 0;
  return parseInt(String(val).replace(/[^0-9-]/g, ''), 10) || 0;
};

export default function PostCard({ post, currentUsername: propUsername, onDelete }: PostCardProps) {
  const [isVoting, setIsVoting] = useState(false); 
  const [votes, setVotes] = useState<number>(parseNumeric(post.score ?? post.upvotes));
  const [userVote, setUserVote] = useState<'up' | 'down' | null>(post.currentUserVote || null);
  const [commentCount, setCommentCount] = useState<number>(parseNumeric(post.commentCount));
  
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [isSpeeding, setIsSpeeding] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(16 / 9);
  const [authToken, setAuthToken] = useState<string | null>(null);
  
  const [activeUsername, setActiveUsername] = useState<string | undefined>(propUsername);

  useEffect(() => {
    setVotes(parseNumeric(post.score ?? post.upvotes));
    setCommentCount(parseNumeric(post.commentCount));
  }, [post]);

  useEffect(() => {
    AsyncStorage.getItem('@ghost_token').then(token => setAuthToken(token));
    if (!propUsername) {
      AsyncStorage.getItem('@active_username').then(user => {
        if (user) setActiveUsername(user);
      });
    } else {
      setActiveUsername(propUsername);
    }
  }, [propUsername]);

  const mediaUrl = post.mediaUrl || post.imageUrl;
  const mediaType = (post.mediaType || '').toUpperCase();
  const isVideo = mediaType === 'VIDEO' || mediaUrl?.endsWith('.mp4') || mediaUrl?.endsWith('.mov');
  const fullMediaUrl = mediaUrl?.startsWith('http') ? mediaUrl : `${BASE_URL}${mediaUrl}`;

  const displayUsername = post.username || 'AnonymousTraveler';
  const displayAvatar = post.avatarUrl || post.profilePictureUrl || null; 
  const isOwner = activeUsername && (post.username === activeUsername); 

  const player = useVideoPlayer(fullMediaUrl, (playerInstance) => { playerInstance.loop = true; });

  const handleVote = async (direction: 'up' | 'down') => {
    if (isVoting) return;
    setIsVoting(true);
    
    const isUp = direction === 'up';
    const newVoteState = userVote === direction ? null : direction;
    let diff = userVote === direction ? (isUp ? -1 : 1) : (userVote === null ? (isUp ? 1 : -1) : (isUp ? 2 : -2));
    
    setVotes(prev => prev + diff);
    setUserVote(newVoteState);

    try {
      await apiClient.post(`/v1/social/post/${post.id}/vote?direction=${newVoteState || 'none'}`);
    } catch (err) {
      setVotes(prev => prev - diff);
      setUserVote(userVote);
    } finally { 
      setIsVoting(false); 
    }
  };

  const handleShare = async () => {
    try {
      const shareUrl = `ghostshield://post/${post.id}`;
      await Share.share({ 
        message: `Check out this post by @${displayUsername} on GhostShield!\n\n"${post.title || post.content}"\n\nTap to view: ${shareUrl}` 
      });
    } catch (error) {
      console.warn("Share logic failed");
    }
  };

  // 🟢 FIX: Platform-safe deletion with aggressive diagnostic logging
  const handleDeleteTrigger = () => {
    console.log("🚨 TRASHCAN TAPPED! Post ID:", post.id);

    // If testing on Web, native Alert.alert often fails silently. This uses the browser's native confirm.
    if (Platform.OS === 'web') {
      const isConfirmed = window.confirm("Are you sure you want to permanently delete this post? All comments and media will be wiped.");
      if (isConfirmed) {
        console.log("✅ Web confirm accepted. Firing deletion request to backend...");
        if (onDelete) onDelete(post.id);
      } else {
        console.log("❌ Web confirm cancelled.");
      }
      return;
    }

    // iOS / Android Native Alert
    Alert.alert(
      "Delete Post", 
      "Are you sure you want to permanently delete this post? All comments, votes, and media will be wiped. This cannot be undone.", 
      [
        { 
          text: "Cancel", 
          style: "cancel",
          onPress: () => console.log("❌ Mobile Alert cancelled.")
        },
        { 
          text: "Yes, Delete", 
          style: "destructive", 
          onPress: () => { 
            console.log("✅ Mobile Alert confirmed. Firing deletion request to backend...");
            if (onDelete) onDelete(post.id); 
          } 
        }
      ]
    );
  };

  const renderAvatar = (url: string | null, fallbackUsername: string) => {
    if (url) {
      const formattedUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
      return <Image source={{ uri: formattedUrl, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.smallAvatarImage} />;
    }
    return <Text style={styles.avatarLetter}>{fallbackUsername[0]?.toUpperCase() || 'U'}</Text>;
  };

  return (
    <View style={styles.card}>
      {/* 🟢 FIX: Added zIndex to header to prevent absolute positioning overlap blocking taps */}
      <View style={[styles.cardHeader, { zIndex: 10 }]}>
        <View style={styles.authorRow}>
          <View style={styles.smallAvatar}>
             {renderAvatar(displayAvatar, displayUsername)}
          </View>
          <Text style={styles.authorName}>@{displayUsername}</Text>
        </View>

        {isOwner && onDelete && (
          // 🟢 FIX: Increased touch target padding and hitSlop for easier tapping
          <TouchableOpacity 
            onPress={handleDeleteTrigger} 
            style={styles.deleteBtn}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
          >
            <Feather name="trash-2" size={16} color="#FF4444" />
          </TouchableOpacity>
        )}
      </View>

      {post.title ? <Text style={styles.postTitle}>{post.title}</Text> : null}
      {post.content ? <Text style={styles.postContent}>{post.content}</Text> : null}

      {mediaUrl ? (
        <View style={styles.mediaContainer}>
          {isVideo ? (
            <Pressable 
              onLongPress={() => { if(player){ player.playbackRate = 2.0; setIsSpeeding(true); }}} 
              onPressOut={() => { if(player){ player.playbackRate = 1.0; setIsSpeeding(false); }}}
              style={{ width: '100%' }}
            >
              <VideoView player={player} style={[styles.mediaElement, { aspectRatio: 16 / 9 }]} nativeControls={true} contentFit="contain" />
              {isSpeeding && <View style={[styles.speedBadge, { pointerEvents: 'none' }]}><Text style={styles.speedText}>[ 2X SPEED ]</Text></View>}
            </Pressable>
          ) : (
            <Image
              source={{ uri: fullMediaUrl, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }}
              style={[styles.mediaElement, { aspectRatio: Math.max(0.8, Math.min(aspectRatio, 2)) }]}
              resizeMode="cover"
            />
          )}
        </View>
      ) : null}

      <View style={styles.actionsBar}>
        <View style={styles.voteGroup}>
          <TouchableOpacity onPress={() => handleVote('up')} style={styles.actionBtn}>
            <Feather name="chevron-up" size={22} color={userVote === 'up' ? '#00C851' : '#666666'} />
          </TouchableOpacity>
          
          <Text style={styles.voteText}>{votes}</Text>
          
          <TouchableOpacity onPress={() => handleVote('down')} style={styles.actionBtn}>
            <Feather name="chevron-down" size={22} color={userVote === 'down' ? '#FF4444' : '#666666'} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.actionBtnWithText} onPress={() => setCommentsVisible(true)}>
          <Feather name="message-circle" size={18} color="#666666" />
          <Text style={styles.actionText}>{commentCount}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtnWithText} onPress={handleShare}>
          <Feather name="share-2" size={18} color="#666666" />
        </TouchableOpacity>
      </View>

      <Modal visible={commentsVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCommentsVisible(false)}>
        <CommentsModal 
          postId={post.id} 
          currentUsername={activeUsername} 
          onClose={() => setCommentsVisible(false)} 
          onCommentAdded={() => setCommentCount(prev => prev + 1)}
          onCommentDeleted={() => setCommentCount(prev => Math.max(0, prev - 1))}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1A1A1A', borderRadius: 8, borderWidth: 1, borderColor: '#262626', marginBottom: 16, padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  smallAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  smallAvatarImage: { width: '100%', height: '100%' },
  avatarLetter: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  authorName: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
  // 🟢 FIX: Added zIndex here to ensure the button is clickable
  deleteBtn: { padding: 8, backgroundColor: 'rgba(255, 68, 68, 0.1)', borderRadius: 8, zIndex: 20 },
  postTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', marginBottom: 8, letterSpacing: 0.5 },
  postContent: { color: '#8E95A5', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  mediaContainer: { width: '100%', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#262626', marginBottom: 16, backgroundColor: '#000000' },
  mediaElement: { width: '100%' },
  speedBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#404040' },
  speedText: { color: '#FFFFFF', fontWeight: '800', fontSize: 10, letterSpacing: 1 },
  actionsBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, borderTopWidth: 1, borderTopColor: '#262626' },
  voteGroup: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#000000', borderRadius: 20, paddingHorizontal: 4, borderWidth: 1, borderColor: '#262626' },
  voteText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, marginHorizontal: 8 },
  actionBtn: { padding: 6 },
  actionBtnWithText: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#000000', borderRadius: 20, borderWidth: 1, borderColor: '#262626' },
  actionText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13, marginLeft: 8 },
});