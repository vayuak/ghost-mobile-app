import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert, RefreshControl, Switch, AppState, AppStateStatus, ScrollView, Image, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications'; 
import { useHighAccuracyLocation } from '../hooks/useHighAccuracyLocation';
import { apiClient, API_ROUTES, BASE_URL } from '../services/api'; 
import { peekAvatarUrl, preloadAvatars, toAbsoluteUrl } from '../services/ProfileCache'; 
import { useTheme } from '../context/ThemeContext'; 

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

async function notifyNewDrop(username: string, distance: number) {
  if (Platform.OS === 'web') return; 
  await Notifications.scheduleNotificationAsync({ content: { title: "New AirDrop Nearby 📍", body: `@${username} ${distance}m away wants to say something.`, sound: true }, trigger: null });
}

interface NearbyDrop {
  username: string; distanceInMeters: number; statusMessage: string; avatarUrl?: string | null; createdAt?: string | number; isSafeText?: boolean; 
}

export const DropsScreen = ({ onUnreadCountChange, navigation }: any) => {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  
  const insets = useSafeAreaInsets();
  const { coords } = useHighAccuracyLocation();

  const [isRadarActive, setIsRadarActive] = useState(true);
  const [drops, setDrops] = useState<NearbyDrop[]>([]);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string>('');

  const previousCountRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const coordsRef = useRef(coords);
  const flatListRef = useRef<FlatList>(null);
  coordsRef.current = coords;

  useEffect(() => { isMountedRef.current = true; fetchUserProfile(); return () => { isMountedRef.current = false; }; }, []);

  useEffect(() => {
    let pingInterval: NodeJS.Timeout;
    if (coords && isRadarActive) {
      apiClient.post(`${API_ROUTES.CAMPFIRE.PING_LOCATION}?lat=${coords.latitude}&lng=${coords.longitude}`).catch(() => {});
      pingInterval = setInterval(() => { if (coordsRef.current && isRadarActive) apiClient.post(`${API_ROUTES.CAMPFIRE.PING_LOCATION}?lat=${coordsRef.current.latitude}&lng=${coordsRef.current.longitude}`).catch(() => {}); }, 30000);
    }
    return () => { if (pingInterval) clearInterval(pingInterval); };
  }, [coords?.latitude, coords?.longitude, isRadarActive]);

  useEffect(() => {
    let scanInterval: NodeJS.Timeout;
    const startScanning = () => { if (coordsRef.current && isRadarActive) { scanRadar(); scanInterval = setInterval(() => { scanRadar(); }, 5000); } };
    const handleAppStateChange = (nextAppState: AppStateStatus) => { if (nextAppState === 'active') { if (!scanInterval) startScanning(); } else { if (scanInterval) clearInterval(scanInterval); } };
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    if (AppState.currentState === 'active') startScanning();
    else { setDrops([]); previousCountRef.current = 0; if (onUnreadCountChange) onUnreadCountChange(0); }
    return () => { if (scanInterval) clearInterval(scanInterval); subscription.remove(); };
  }, [coords?.latitude, coords?.longitude, isRadarActive]);

  const fetchUserProfile = async () => {
    try { const user = await apiClient.get(API_ROUTES.AUTH.ME); if (user?.username && isMountedRef.current) setCurrentUsername(user.username.replace(/^@/, '').trim().toLowerCase()); } catch (e) { }
  };

  const getSecureImageSource = (uri: string) => { 
    const cleanUrl = uri.startsWith('http') ? uri : `${BASE_URL}${uri.startsWith('/') ? uri : `/${uri}`}`;
    return { uri: cleanUrl }; 
  };

  const scanRadar = async () => {
    if (!coordsRef.current || !isRadarActive) return;
    try {
      const response: NearbyDrop[] = await apiClient.get(`${API_ROUTES.CAMPFIRE.SCAN}?lat=${coordsRef.current.latitude}&lng=${coordsRef.current.longitude}`);
      if (!isMountedRef.current) return;
      const freshDrops = response || [];
      const usernames = freshDrops.map((drop) => drop.username.replace(/^@/, '').trim().toLowerCase());
      await preloadAvatars(usernames);

      const dropsWithAvatars = freshDrops.map((drop) => {
        const cleanUser = drop.username.replace(/^@/, '').trim().toLowerCase();
        let dp = peekAvatarUrl(cleanUser);
        if (!dp && drop.avatarUrl) dp = toAbsoluteUrl(drop.avatarUrl);
        return { ...drop, username: cleanUser, avatarUrl: dp };
      });

      const sortedDrops = dropsWithAvatars.sort((a, b) => (a.createdAt && b.createdAt) ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() : 0);
      setDrops(sortedDrops);

      if (freshDrops.length !== previousCountRef.current) {
        if (freshDrops.length > previousCountRef.current) {
          if (Platform.OS !== 'web') Notifications.setBadgeCountAsync(freshDrops.length);
          const newestDrop = sortedDrops[0];
          if (newestDrop && newestDrop.username !== currentUsername) notifyNewDrop(newestDrop.username, newestDrop.distanceInMeters);
        }
        previousCountRef.current = freshDrops.length;
        if (onUnreadCountChange) onUnreadCountChange(freshDrops.length);
      }
    } catch (e: any) { }
  };

  const handleToggleRadar = (value: boolean) => {
    setIsRadarActive(value);
    if (!value) {
      setDrops([]); previousCountRef.current = 0;
      if (onUnreadCountChange) onUnreadCountChange(0);
      if (Platform.OS !== 'web') Notifications.setBadgeCountAsync(0); 
    }
  };

  const handlePostDrop = async () => {
    if (!isRadarActive || !message.trim()) return;
    if (!coordsRef.current) return Alert.alert('Acquiring Location', 'Obtaining precise GPS location...');
    
    const tempMessage = message.trim();
    setMessage(''); 
    
    const optimisticDrop: NearbyDrop = { username: currentUsername, distanceInMeters: 0, statusMessage: tempMessage, avatarUrl: peekAvatarUrl(currentUsername), createdAt: new Date().toISOString(), isSafeText: true };
    setDrops((prev) => [optimisticDrop, ...prev]);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });

    try {
      await apiClient.post(API_ROUTES.CAMPFIRE.DROP, { latitude: coordsRef.current.latitude, longitude: coordsRef.current.longitude, statusMessage: tempMessage });
      scanRadar(); 
    } catch (e: any) {
      setDrops((prev) => prev.filter((d) => d !== optimisticDrop));
      setMessage(tempMessage);
      const errorMessage = e?.response?.data?.message || e?.message || 'Network disconnected. Could not post drop.';
      if (errorMessage.toLowerCase().includes('limit')) Alert.alert('Out of AirDrops 🎈', 'You have used all 10 free AirDrops for today. Upgrade to Premium for unlimited drops!', [{ text: 'Wait for reset', style: 'cancel' }, { text: 'Get Premium', onPress: () => navigation?.navigate('PremiumSubscription') }]);
      else Alert.alert('AirDrop Failed', errorMessage, [{ text: 'OK' }]);
    }
  };

  const handleReportUser = (username: string) => {
    if (username === currentUsername) return;
    Alert.alert('Report AirDrop', `Report @${username}? 3 reports will permanently block this user.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Report', style: 'destructive', onPress: async () => { try { await apiClient.post(API_ROUTES.CAMPFIRE.REPORT(username)); Alert.alert('Reported', `@${username} reported.`); await scanRadar(); } catch (e: any) { Alert.alert('Report Error', e?.response?.data?.message || 'Could not report.'); } } }
    ]);
  };

  const handleRefresh = async () => { if (!isRadarActive) return; setRefreshing(true); await scanRadar(); if (isMountedRef.current) setRefreshing(false); };

  const DropContent = ({ drop, isSelf }: { drop: NearbyDrop, isSelf: boolean }) => {
    const [isRevealed, setIsRevealed] = useState(isSelf || drop.isSafeText !== false);
    if (!isRevealed) {
      return (
        <TouchableOpacity style={styles.warningBox} activeOpacity={0.7} onPress={() => setIsRevealed(true)}>
          <Feather name="eye-off" size={18} color={colors.warning} />
          <Text style={styles.warningTitle}>Unverified Content</Text>
          <Text style={styles.warningSubText}>AI scan timed out. Tap to view.</Text>
        </TouchableOpacity>
      );
    }
    return <Text style={styles.messageText}>{drop.statusMessage}</Text>;
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View>
          <Text style={styles.title}>AirDrops</Text>
          <Text style={styles.subtitle}>{isRadarActive ? coords ? `Radar Active • 100m Radius` : 'Acquiring GPS...' : 'Radar Disabled'}</Text>
        </View>
        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>{isRadarActive ? 'ON' : 'OFF'}</Text>
          <Switch value={isRadarActive} onValueChange={handleToggleRadar} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={isRadarActive ? '#FFFFFF' : '#737373'} />
        </View>
      </View>

      <View style={styles.topInputContainer}>
        <TextInput style={styles.topInput} placeholder={isRadarActive ? 'Drop a message nearby...' : 'Turn on radar to send drops'} placeholderTextColor={colors.textMuted} value={message} onChangeText={setMessage} editable={isRadarActive} maxLength={150} multiline />
        <TouchableOpacity style={[styles.sendButton, (!isRadarActive || !message.trim()) && styles.sendButtonDisabled]} onPress={handlePostDrop} disabled={!isRadarActive || !message.trim()}>
          <Feather name="arrow-down" size={18} color={isRadarActive && message.trim() ? colors.background : colors.textMuted} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {!isRadarActive || drops.length === 0 ? (
          <ScrollView contentContainerStyle={styles.emptyScrollContainer} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.text} enabled={isRadarActive} />}>
            <View style={styles.emptyContainer}>
              <Feather name={isRadarActive ? 'radio' : 'power'} size={32} color={colors.border} style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>{isRadarActive ? 'No AirDrops nearby (100m)' : 'AirDrop is turned off'}</Text>
              <Text style={styles.emptySubText}>{isRadarActive ? 'Type above to drop a message in this area.' : 'Toggle the switch at top right to start receiving local drops.'}</Text>
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={flatListRef} data={drops} keyExtractor={(item, index) => `${item.username}-${index}`}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.text} enabled={isRadarActive} />}
            renderItem={({ item }) => {
              const cleanCurrentUsername = currentUsername.replace(/^@/, '').trim().toLowerCase();
              const isSelf = item.username === cleanCurrentUsername && cleanCurrentUsername.length > 0;
              return (
                <View style={[styles.messageRow, isSelf ? styles.messageRowSelf : styles.messageRowOther]}>
                  {!isSelf && (
                    <View style={[styles.bubble, styles.bubbleOther]}>
                      <View style={styles.bubbleHeader}>
                        {item.avatarUrl ? <Image source={getSecureImageSource(item.avatarUrl)} style={styles.airdropAvatarImage} /> : <View style={styles.airdropAvatarFallback}><Text style={styles.airdropAvatarText}>{item.username[0]?.toUpperCase()}</Text></View>}
                        <Text style={styles.senderName}>@{item.username}</Text>
                        <Text style={styles.distanceMeta}>• {item.distanceInMeters}m</Text>
                      </View>
                      <DropContent drop={item} isSelf={isSelf} />
                    </View>
                  )}
                  {!isSelf && <TouchableOpacity style={styles.reportIcon} onPress={() => handleReportUser(item.username)}><Feather name="flag" size={14} color={colors.textMuted} /></TouchableOpacity>}
                  {isSelf && <View style={[styles.bubble, styles.bubbleSelf]}><DropContent drop={item} isSelf={isSelf} /></View>}
                </View>
              );
            }}
          />
        )}
      </View>
    </View>
  );
};

const getStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: colors.background, zIndex: 10 },
  title: { color: colors.text, fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 2 },
  switchContainer: { flexDirection: 'row', alignItems: 'center' },
  switchLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '800', marginRight: 8 },
  topInputContainer: { backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 8 },
  // 🟢 FIX: Borderless, clean input field
  topInput: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: 20, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontSize: 15, marginRight: 10, minHeight: 40, maxHeight: 100 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.text, justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: colors.surface },
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 },
  emptyScrollContainer: { flexGrow: 1, justifyContent: 'center' },
  emptyContainer: { alignItems: 'center', paddingHorizontal: 32 },
  emptyText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptySubText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  messageRow: { flexDirection: 'row', marginBottom: 16, alignItems: 'flex-start' },
  messageRowSelf: { justifyContent: 'flex-end' },
  messageRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  // 🟢 FIX: Pure color bubbles with subtle shadow, NO rigid borders
  bubbleSelf: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderBottomLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  bubbleOther: { backgroundColor: colors.surface, borderTopLeftRadius: 18, borderBottomRightRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  bubbleHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  airdropAvatarImage: { width: 22, height: 22, borderRadius: 11, marginRight: 8, backgroundColor: colors.background },
  airdropAvatarFallback: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  airdropAvatarText: { color: colors.text, fontSize: 10, fontWeight: 'bold' },
  senderName: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  distanceMeta: { color: colors.textMuted, fontSize: 10, fontWeight: '600', marginLeft: 6 },
  messageText: { color: colors.text, fontSize: 15, lineHeight: 20 },
  reportIcon: { marginLeft: 8, marginTop: 8, padding: 4 },
  warningBox: { backgroundColor: isDarkMode ? '#332701' : '#FFFBEB', padding: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.warning, marginTop: 4 },
  warningTitle: { color: colors.warning, fontSize: 13, fontWeight: 'bold', marginTop: 4 },
  warningSubText: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});