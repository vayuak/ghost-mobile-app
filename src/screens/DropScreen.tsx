import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert, RefreshControl, Switch, AppState, AppStateStatus, ScrollView, Image, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useHighAccuracyLocation } from '../hooks/useHighAccuracyLocation';
import { apiClient, API_ROUTES, BASE_URL } from '../services/api';
import { peekAvatarUrl, preloadAvatars, toAbsoluteUrl } from '../services/ProfileCache';
import { useTheme } from '../context/ThemeContext';

const SCAN_INTERVAL_MS = 10000; // AirDrops live for 10 minutes, so a 10 s refresh is plenty (was 5 s)

async function notifyNewDrop(username: string, distance: number) {
  if (Platform.OS === 'web') return;
  await Notifications.scheduleNotificationAsync({ content: { title: "New AirDrop Nearby 📍", body: `@${username} ${distance}m away wants to say something.`, sound: true }, trigger: null });
}

interface NearbyDrop {
  username: string; distanceInMeters: number; statusMessage: string; avatarUrl?: string | null; createdAt?: string | number; isSafeText?: boolean;
}

// Declared at module level so its "revealed" state survives parent re-renders (it used to be re-created on every render).
const DropContent = ({ drop, isSelf, styles, colors }: { drop: NearbyDrop; isSelf: boolean; styles: any; colors: any }) => {
  const [isRevealed, setIsRevealed] = useState(isSelf || drop.isSafeText !== false);
  if (!isRevealed) {
    return (
      <TouchableOpacity style={styles.warningBox} activeOpacity={0.7} onPress={() => setIsRevealed(true)}>
        <Feather name="eye-off" size={18} color={colors.warning} />
        <Text style={styles.warningTitle}>Unverified Content</Text>
        <Text style={styles.warningSubText}>Tap to view.</Text>
      </TouchableOpacity>
    );
  }
  return <Text style={styles.messageText}>{drop.statusMessage}</Text>;
};

export const DropsScreen = ({ onUnreadCountChange, navigation }: any) => {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);

  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { coords, errorMsg } = useHighAccuracyLocation();

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

  // Scan only while the tab is on screen and the app is in the foreground (saves battery and server load).
  useEffect(() => {
    let scanInterval: ReturnType<typeof setInterval> | undefined;
    const stop = () => { if (scanInterval) { clearInterval(scanInterval); scanInterval = undefined; } };
    const startScanning = () => {
      stop();
      if (coordsRef.current && isRadarActive && isFocused) {
        scanRadar();
        scanInterval = setInterval(() => { scanRadar(); }, SCAN_INTERVAL_MS);
      }
    };
    const handleAppStateChange = (nextAppState: AppStateStatus) => { if (nextAppState === 'active') startScanning(); else stop(); };
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    if (AppState.currentState === 'active') startScanning();
    else { setDrops([]); previousCountRef.current = 0; if (onUnreadCountChange) onUnreadCountChange(0); }
    return () => { stop(); subscription.remove(); };
  }, [coords?.latitude, coords?.longitude, isRadarActive, isFocused]);

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
      const freshDrops = Array.isArray(response) ? response : [];
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
    if (!coordsRef.current) return Alert.alert('Acquiring Location', errorMsg || 'Obtaining your GPS location...');

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
      const errorMessage = e?.message || 'Network disconnected. Could not post drop.';
      if (errorMessage.toLowerCase().includes('limit')) Alert.alert('Daily limit reached 🎈', 'You have used all 10 free AirDrops for today. Your limit resets at midnight.');
      else Alert.alert('AirDrop not sent', errorMessage, [{ text: 'OK' }]);
    }
  };

  const handleReportUser = (username: string) => {
    if (username === currentUsername) return;
    Alert.alert('Report AirDrop', `Report @${username}? Three reports from different people will permanently block this user.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive', onPress: async () => { try { await apiClient.post(API_ROUTES.CAMPFIRE.REPORT(username)); Alert.alert('Reported', `@${username} reported. Thank you.`); await scanRadar(); } catch (e: any) { Alert.alert('Report', e?.message || 'Could not report.'); } } }
    ]);
  };

  const handleRefresh = async () => { if (!isRadarActive) return; setRefreshing(true); await scanRadar(); if (isMountedRef.current) setRefreshing(false); };

  const subtitle = !isRadarActive ? 'Radar Disabled' : errorMsg ? errorMsg : coords ? 'Radar Active • 100m Radius' : 'Acquiring GPS...';

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.title}>AirDrops</Text>
          <Text style={[styles.subtitle, errorMsg && isRadarActive ? { color: colors.danger } : null]} numberOfLines={2}>{subtitle}</Text>
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
      <Text style={styles.rulesHint}>Visible for 10 minutes to people within 100 m. No links, phone numbers or promotions.</Text>

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
            ref={flatListRef} data={drops} keyExtractor={(item, index) => `${item.username}-${item.createdAt ?? index}-${index}`}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.text} enabled={isRadarActive} />}
            renderItem={({ item }) => {
              const cleanCurrentUsername = currentUsername.replace(/^@/, '').trim().toLowerCase();
              const isSelf = item.username === cleanCurrentUsername && cleanCurrentUsername.length > 0;
              const isSystem = item.username.toLowerCase() === 'system' || item.username.toLowerCase() === 'system_ai';

              return (
                <View style={[styles.messageRow, isSelf ? styles.messageRowSelf : styles.messageRowOther]}>
                  {!isSelf && (
                    <View style={[styles.bubble, isSystem ? styles.bubbleSystem : styles.bubbleOther]}>
                      <View style={styles.bubbleHeader}>
                        {item.avatarUrl && !isSystem ? (
                          <Image source={getSecureImageSource(item.avatarUrl)} style={styles.airdropAvatarImage} />
                        ) : (
                          <View style={[styles.airdropAvatarFallback, isSystem && { backgroundColor: colors.danger }]}>
                            <Text style={[styles.airdropAvatarText, isSystem && { color: '#FFF' }]}>
                              {isSystem ? '⚠️' : item.username[0]?.toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <Text style={[styles.senderName, isSystem && { color: colors.danger }]}>@{item.username}</Text>
                        <Text style={styles.distanceMeta}>• {item.distanceInMeters}m</Text>
                      </View>

                      {isSystem ? (
                        <Text style={[styles.messageText, { color: colors.danger, fontWeight: '600' }]}>{item.statusMessage}</Text>
                      ) : (
                        <DropContent drop={item} isSelf={isSelf} styles={styles} colors={colors} />
                      )}
                    </View>
                  )}

                  {!isSelf && !isSystem && (
                    <TouchableOpacity style={styles.reportIcon} onPress={() => handleReportUser(item.username)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Feather name="flag" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  )}

                  {isSelf && <View style={[styles.bubble, styles.bubbleSelf]}><DropContent drop={item} isSelf={isSelf} styles={styles} colors={colors} /></View>}
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
  topInputContainer: { backgroundColor: colors.background, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6, paddingTop: 8 },
  topInput: { flex: 1, backgroundColor: colors.surface, color: colors.text, borderRadius: 20, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontSize: 15, marginRight: 10, minHeight: 40, maxHeight: 100 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.text, justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: colors.surface },
  rulesHint: { color: colors.textMuted, fontSize: 11, paddingHorizontal: 20, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100 },
  emptyScrollContainer: { flexGrow: 1, justifyContent: 'center' },
  emptyContainer: { alignItems: 'center', paddingHorizontal: 32 },
  emptyText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptySubText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  messageRow: { flexDirection: 'row', marginBottom: 16, alignItems: 'flex-start' },
  messageRowSelf: { justifyContent: 'flex-end' },
  messageRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
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
  bubbleSystem: {
    backgroundColor: isDarkMode ? '#3A1010' : '#FFEEEE',
    borderTopLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.danger
  },
});
