import React, { useState, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, Share, Alert, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import Toast from 'react-native-toast-message';
import { apiClient, BASE_URL, API_ROUTES } from '../services/api';
import { blockLocalUser, isUserBlocked } from '../services/LocalDB';
import { postShareUrl } from '../constants/links';
import CommentsModal from './CommentsModal';
import { useTheme } from '../context/ThemeContext';

interface PostCardProps {
  post: any;
  currentUsername?: string;
  onDelete?: (postId: any) => void;
  isVisible?: boolean;
  onUserTap?: () => void;
  onCommentTap?: () => void;
  disableCommentAction?: boolean;
}

const parseNumeric = (val: any) => parseInt(String(val).replace(/[^0-9-]/g, ''), 10) || 0;

// Video is its own component so photo posts never create a video player (a player per card was a big memory cost in feeds).
function VideoMedia({ source, shouldPlay, styles }: { source: any; shouldPlay: boolean; styles: any }) {
  const player = useVideoPlayer(source, (p) => { if (p) p.loop = true; });
  const [isSpeeding, setIsSpeeding] = useState(false);

  useEffect(() => {
    if (!player) return;
    if (shouldPlay) player.play(); else player.pause();
  }, [shouldPlay, player]);

  return (
    <Pressable
      onLongPress={() => { if (player) { player.playbackRate = 2.0; setIsSpeeding(true); } }}
      onPressOut={() => { if (player) { player.playbackRate = 1.0; setIsSpeeding(false); } }}
      style={{ width: '100%' }}
    >
      <VideoView player={player} style={styles.mediaElement} nativeControls={true} contentFit="contain" />
      {isSpeeding && <View style={styles.speedBadge} pointerEvents="none"><Text style={styles.speedText}>[ 2X SPEED ]</Text></View>}
    </Pressable>
  );
}

export default function PostCard({ post, currentUsername: propUsername, onDelete, isVisible = true, onUserTap, onCommentTap, disableCommentAction }: PostCardProps) {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  const isFocused = useIsFocused();

  const [votes, setVotes] = useState<number>(parseNumeric(post.score ?? post.upvotes));
  const [userVote, setUserVote] = useState<'up' | 'down' | null>(post.currentUserVote === 'up' || post.currentUserVote === 'down' ? post.currentUserVote : null);
  const [commentCount, setCommentCount] = useState<number>(parseNumeric(post.commentCount));
  const [commentsVisible, setCommentsVisible] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [activeUsername, setActiveUsername] = useState<string | undefined>(propUsername);
  const [isHidden, setIsHidden] = useState(false);

  useEffect(() => { setVotes(parseNumeric(post.score ?? post.upvotes)); setCommentCount(parseNumeric(post.commentCount)); }, [post]);

  useEffect(() => {
    AsyncStorage.getItem('@ghost_token').then(setAuthToken);
    if (!propUsername) AsyncStorage.getItem('@active_username').then(user => { if (user) setActiveUsername(user); });
    else setActiveUsername(propUsername);
    AsyncStorage.getItem(`@hidden_post_${post.id}`).then(val => { if (val === 'true') setIsHidden(true); });
  }, [propUsername, post.id]);

  const isVideo = (post.mediaType || '').toUpperCase() === 'VIDEO' || post.mediaUrl?.endsWith('.mp4');
  const fullMediaUrl = post.mediaUrl ? (post.mediaUrl.startsWith('http') ? post.mediaUrl : `${BASE_URL}${post.mediaUrl}`) : null;
  const displayUsername = post.username || 'Anonymous';
  const isOwner = !!activeUsername && (String(post.username).toLowerCase() === String(activeUsername).toLowerCase());

  const mediaSource = useMemo(() => fullMediaUrl ? { uri: fullMediaUrl, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined } : null, [fullMediaUrl, authToken]);

  const handleVote = async (direction: 'up' | 'down') => {
    const isUp = direction === 'up';
    const newVoteState = userVote === direction ? null : direction;
    let diff = userVote === direction ? (isUp ? -1 : 1) : (userVote === null ? (isUp ? 1 : -1) : (isUp ? 2 : -2));
    setVotes(prev => prev + diff); setUserVote(newVoteState);
    try { await apiClient.post(API_ROUTES.POSTS.VOTE(post.id, newVoteState || 'none')); } catch { setVotes(prev => prev - diff); setUserVote(userVote); }
  };

  const handleShare = async () => {
    try {
      const shareUrl = postShareUrl(post.id);
      await Share.share({ message: `Check out this post by @${displayUsername} on WarnPack!\n\n${shareUrl}`, url: shareUrl, title: 'WarnPack Post' });
    } catch (error) {}
  };

  const handleDeleteTrigger = () => Alert.alert('Delete', 'Permanently delete this post?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { if (onDelete) onDelete(post.id); } }]);

  const reportPost = async () => {
    try { await apiClient.post(API_ROUTES.MODERATION.REPORT, { targetId: post.id, type: 'POST_REPORT' }); } catch { /* still hide it locally */ }
    await AsyncStorage.setItem(`@hidden_post_${post.id}`, 'true');
    setIsHidden(true);
    Toast.show({ type: 'success', text1: 'Reported', text2: 'Thanks. This post is hidden for you and will be reviewed.' });
  };

  const handleBlockAuthor = () => {
    Alert.alert('Block user', `Hide all posts and comments from @${displayUsername} and stop receiving their messages?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => { blockLocalUser(displayUsername); setIsHidden(true); Toast.show({ type: 'success', text1: 'User blocked', text2: 'You can unblock them in Settings > Blocked Users.' }); } },
    ]);
  };

  const handleMore = () => Alert.alert('Post options', `@${displayUsername}`, [
    { text: 'Report this post', style: 'destructive', onPress: reportPost },
    { text: `Block @${displayUsername}`, style: 'destructive', onPress: handleBlockAuthor },
    { text: 'Cancel', style: 'cancel' },
  ]);

  const renderAvatar = () => {
    const url = post.avatarUrl || post.profilePictureUrl;
    if (url) return <Image source={{ uri: url.startsWith('http') ? url : `${BASE_URL}${url}`, headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined }} style={styles.smallAvatarImage} />;
    return <Text style={styles.avatarLetter}>{displayUsername[0]?.toUpperCase()}</Text>;
  };

  if (isHidden || (!isOwner && isUserBlocked(String(displayUsername)))) return null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <TouchableOpacity style={styles.authorRow} onPress={onUserTap} disabled={!onUserTap}>
          <View style={styles.smallAvatar}>{renderAvatar()}</View>
          <Text style={styles.authorName}>@{displayUsername}</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {isOwner && onDelete && <TouchableOpacity onPress={handleDeleteTrigger} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="trash-2" size={16} color={colors.danger} /></TouchableOpacity>}
          {!isOwner && <TouchableOpacity onPress={handleMore} style={{ marginLeft: 12 }} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="more-horizontal" size={18} color={colors.textMuted} /></TouchableOpacity>}
        </View>
      </View>

      {post.title ? <Text style={styles.postTitle}>{post.title}</Text> : null}
      {post.content ? <Text style={styles.postContent}>{post.content}</Text> : null}

      {mediaSource ? (
        <View style={styles.mediaContainer}>
          {isVideo ? (
            <VideoMedia source={mediaSource} shouldPlay={isVisible && !isHidden && isFocused && !commentsVisible} styles={styles} />
          ) : (
            <Image source={mediaSource as any} style={styles.mediaElement} resizeMode="cover" />
          )}
        </View>
      ) : null}

      <View style={styles.actionsBar}>
        <View style={styles.voteGroup}>
          <TouchableOpacity onPress={() => handleVote('up')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="chevron-up" size={24} color={userVote === 'up' ? colors.primary : colors.textMuted} /></TouchableOpacity>
          <Text style={styles.voteText}>{votes}</Text>
          <TouchableOpacity onPress={() => handleVote('down')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="chevron-down" size={24} color={userVote === 'down' ? colors.danger : colors.textMuted} /></TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {!disableCommentAction && (
            <TouchableOpacity style={styles.actionBtnIcon} onPress={onCommentTap || (() => setCommentsVisible(true))}>
              <Feather name="message-circle" size={22} color={colors.text} /><Text style={styles.actionText}>{commentCount}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.actionBtnIcon} onPress={handleShare}><Feather name="send" size={22} color={colors.text} /></TouchableOpacity>
        </View>
      </View>

      <CommentsModal visible={commentsVisible} postId={post.id} currentUsername={activeUsername} onClose={() => setCommentsVisible(false)} onCommentAdded={() => setCommentCount(prev => prev + 1)} onCommentDeleted={() => setCommentCount(prev => Math.max(0, prev - 1))} />
    </View>
  );
}

const getStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
  card: { backgroundColor: colors.background, paddingVertical: 16, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingHorizontal: 16 },
  authorRow: { flexDirection: 'row', alignItems: 'center' },
  smallAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, justifyContent: 'center', alignItems: 'center', marginRight: 10, overflow: 'hidden' },
  smallAvatarImage: { width: '100%', height: '100%' },
  avatarLetter: { color: colors.text, fontWeight: '900', fontSize: 14 },
  authorName: { color: colors.text, fontWeight: '700', fontSize: 14 },
  postTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 6, paddingHorizontal: 16 },
  postContent: { color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: 12, paddingHorizontal: 16 },
  mediaContainer: { width: '100%', backgroundColor: colors.surface, overflow: 'hidden' },
  mediaElement: { width: '100%', aspectRatio: 1 },
  speedBadge: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.8)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  speedText: { color: '#FFFFFF', fontWeight: '800', fontSize: 10, letterSpacing: 1 },
  actionsBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingHorizontal: 16 },
  voteGroup: { flexDirection: 'row', alignItems: 'center' },
  voteText: { color: colors.text, fontWeight: '800', fontSize: 15, marginHorizontal: 12 },
  actionBtnIcon: { flexDirection: 'row', alignItems: 'center', marginLeft: 20 },
  actionText: { color: colors.text, fontWeight: '700', fontSize: 14, marginLeft: 6 },
});
