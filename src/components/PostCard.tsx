import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, Share, Alert, Pressable, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { apiClient, BASE_URL, API_ROUTES } from '../services/api'; 
import CommentsModal from './CommentsModal';
import { useTheme } from '../context/ThemeContext'; 

interface PostCardProps {
  post: any;
  currentUsername?: string;
  onDelete?: (postId: any) => void;
  isVisible?: boolean; 
  onUserTap?: () => void; 
  onCommentTap?: () => void; 
}

const parseNumeric = (val: any) => parseInt(String(val).replace(/[^0-9-]/g, ''), 10) || 0;

export default function PostCard({ post, currentUsername: propUsername, onDelete, isVisible = true, onUserTap, onCommentTap }: PostCardProps) {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  const isFocused = useIsFocused(); 

  const [isVoting, setIsVoting] = useState(false); 
  const [votes, setVotes] = useState<number>(parseNumeric(post.score ?? post.upvotes));
  const [userVote, setUserVote] = useState<'up' | 'down' | null>(post.currentUserVote || null);
  const [commentCount, setCommentCount] = useState<number>(parseNumeric(post.commentCount));
  
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [isSpeeding, setIsSpeeding] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [shieldKey, setShieldKey] = useState<string>('PermanentSecret999');
  
  const [activeUsername, setActiveUsername] = useState<string | undefined>(propUsername);
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => {
    setVotes(parseNumeric(post.score ?? post.upvotes));
    setCommentCount(parseNumeric(post.commentCount));
  }, [post]);

  useEffect(() => {
    AsyncStorage.getItem('@ghost_token').then(token => setAuthToken(token));
    if (!propUsername) { AsyncStorage.getItem('@active_username').then(user => { if (user) setActiveUsername(user); }); } 
    else { setActiveUsername(propUsername); }
    AsyncStorage.getItem(`@hidden_post_${post.id}`).then(val => { if (val === 'true') setIsHidden(true); });
  }, [propUsername, post.id]);

  const mediaUrl = post.mediaUrl || post.imageUrl;
  const mediaType = (post.mediaType || '').toUpperCase();
  const isVideo = mediaType === 'VIDEO' || mediaUrl?.endsWith('.mp4') || mediaUrl?.endsWith('.mov');
  const fullMediaUrl = mediaUrl?.startsWith('http') ? mediaUrl : `${BASE_URL}${mediaUrl}`;

  const displayUsername = post.username || 'AnonymousTraveler';
  const displayAvatar = post.avatarUrl || post.profilePictureUrl || null; 
  const isOwner = activeUsername && (post.username === activeUsername); 

  const authenticatedMediaSource = useMemo(() => {
    if (!fullMediaUrl) return null;
    const headers: Record<string, string> = { 'X-Ghost-Shield-Key': shieldKey };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    return { uri: fullMediaUrl, headers };
  }, [fullMediaUrl, authToken, shieldKey]);

  const player = useVideoPlayer(authenticatedMediaSource, (p) => { if (p) p.loop = true; });

  useEffect(() => {
    if (isVideo && player) {
      if (isVisible && !isHidden && isFocused && !commentsVisible) { player.play(); } 
      else { player.pause(); }
    }
  }, [isVisible, isHidden, isVideo, player, isFocused, commentsVisible]);

  const handleVote = async (direction: 'up' | 'down') => {
    if (isVoting) return;
    setIsVoting(true);
    const isUp = direction === 'up';
    const newVoteState = userVote === direction ? null : direction;
    let diff = userVote === direction ? (isUp ? -1 : 1) : (userVote === null ? (isUp ? 1 : -1) : (isUp ? 2 : -2));
    
    setVotes(prev => prev + diff);
    setUserVote(newVoteState);

    try { await apiClient.post(API_ROUTES.POSTS.VOTE(post.id, newVoteState || 'none')); } 
    catch (err) { setVotes(prev => prev - diff); setUserVote(userVote); } 
    finally { setIsVoting(false); }
  };

  const handleShare = async () => {
    try {
      const shareUrl = `viacustos://post/${post.id}`;
      const snippet = post.title || post.content || '';
      await Share.share({ message: `Check out this post by @${displayUsername} on ViaCustos!\n\n"${snippet}"\n\nTap to view: ${shareUrl}`, url: shareUrl, title: post.title || 'ViaCustos Post' });
      apiClient.post(`/v1/social/post/${post.id}/share`).catch(() => {});
    } catch (error) {}
  };

  const handleDeleteTrigger = () => {
    Alert.alert("Delete Post", "Are you sure you want to permanently delete this post?", [
      { text: "Cancel", style: "cancel" },
      { text: "Yes, Delete", style: "destructive", onPress: () => { if (onDelete) onDelete(post.id); } }
    ]);
  };

  const handleReportPost = () => {
    Alert.alert('Report Post', 'Flag this content for review?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive', onPress: async () => {
          apiClient.post(API_ROUTES.MODERATION.REPORT, { targetId: post.id, type: 'POST_REPORT' }).catch(()=>{});
          await AsyncStorage.setItem(`@hidden_post_${post.id}`, 'true');
          setIsHidden(true);
          Alert.alert('Reported', 'Post hidden and flagged.');
      }}
    ]);
  };

  const renderAvatar = (url: string | null, fallbackUsername: string) => {
    if (url) {
      const formattedUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
      return <Image source={{ uri: formattedUrl, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.smallAvatarImage} />;
    }
    return <Text style={styles.avatarLetter}>{fallbackUsername[0]?.toUpperCase() || 'U'}</Text>;
  };

  if (isHidden) return null;

  return (
    <View style={styles.card}>
      <View style={[styles.cardHeader, { zIndex: 10 }]}>
        <TouchableOpacity style={styles.authorRow} onPress={onUserTap} disabled={!onUserTap}>
          <View style={styles.smallAvatar}>{renderAvatar(displayAvatar, displayUsername)}</View>
          <Text style={styles.authorName}>@{displayUsername}</Text>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {isOwner && onDelete && (
            <TouchableOpacity onPress={handleDeleteTrigger} style={styles.deleteBtn} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="trash-2" size={16} color={colors.danger} /></TouchableOpacity>
          )}
          {!isOwner && (
            <TouchableOpacity onPress={handleReportPost} style={{ padding: 8, marginLeft: 8 }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="more-horizontal" size={18} color={colors.textMuted} /></TouchableOpacity>
          )}
        </View>
      </View>

      {post.title ? <Text style={styles.postTitle}>{post.title}</Text> : null}
      {post.content ? <Text style={styles.postContent}>{post.content}</Text> : null}

      {mediaUrl ? (
        <View style={styles.mediaContainer}>
          {isVideo ? (
            <Pressable onLongPress={() => { if(player){ player.playbackRate = 2.0; setIsSpeeding(true); }}} onPressOut={() => { if(player){ player.playbackRate = 1.0; setIsSpeeding(false); }}} style={{ width: '100%' }}>
              <VideoView player={player} style={[styles.mediaElement, { aspectRatio: 1 }]} nativeControls={true} contentFit="contain" />
              {isSpeeding && <View style={styles.speedBadge} pointerEvents="none"><Text style={styles.speedText}>[ 2X SPEED ]</Text></View>}
            </Pressable>
          ) : (
            <Image source={authenticatedMediaSource as any} style={[styles.mediaElement, { aspectRatio: 1 }]} resizeMode="cover" />
          )}
        </View>
      ) : null}

      <View style={styles.actionsBar}>
        <View style={styles.voteGroup}>
          <TouchableOpacity onPress={() => handleVote('up')} style={styles.actionBtn}><Feather name="chevron-up" size={22} color={userVote === 'up' ? colors.primary : colors.textMuted} /></TouchableOpacity>
          <Text style={styles.voteText}>{votes}</Text>
          <TouchableOpacity onPress={() => handleVote('down')} style={styles.actionBtn}><Feather name="chevron-down" size={22} color={userVote === 'down' ? colors.danger : colors.textMuted} /></TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.actionBtnWithText} onPress={onCommentTap || (() => setCommentsVisible(true))}>
          <Feather name="message-circle" size={18} color={colors.textMuted} />
          <Text style={styles.actionText}>{commentCount}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtnWithText} onPress={handleShare}>
          <Feather name="share-2" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <CommentsModal 
        visible={commentsVisible}
        postId={post.id} 
        currentUsername={activeUsername} 
        onClose={() => setCommentsVisible(false)} 
        onCommentAdded={() => setCommentCount(prev => prev + 1)}
        onCommentDeleted={() => setCommentCount(prev => Math.max(0, prev - 1))}
      />
    </View>
  );
}

const getStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
  card: { backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginBottom: 16, padding: 16, marginHorizontal: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  smallAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  smallAvatarImage: { width: '100%', height: '100%' },
  avatarLetter: { color: colors.text, fontWeight: '900', fontSize: 14 },
  authorName: { color: colors.text, fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
  deleteBtn: { padding: 8, backgroundColor: isDarkMode ? 'rgba(255, 68, 68, 0.1)' : 'rgba(255, 59, 48, 0.1)', borderRadius: 8, zIndex: 20 },
  postTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 8, letterSpacing: 0.5 },
  postContent: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 16 },
  mediaContainer: { width: '100%', borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, marginBottom: 16, backgroundColor: isDarkMode ? '#000' : '#E5E5EA' },
  mediaElement: { width: '100%' },
  speedBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#404040' },
  speedText: { color: '#FFFFFF', fontWeight: '800', fontSize: 10, letterSpacing: 1 },
  actionsBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border },
  voteGroup: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 4, borderWidth: 1, borderColor: colors.border },
  voteText: { color: colors.text, fontWeight: '800', fontSize: 14, marginHorizontal: 8 },
  actionBtn: { padding: 6 },
  actionBtnWithText: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  actionText: { color: colors.text, fontWeight: '800', fontSize: 13, marginLeft: 8 },
});