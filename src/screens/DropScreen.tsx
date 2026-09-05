import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Switch,
  KeyboardAvoidingView,
  Platform,
  AppState,
  AppStateStatus,
  ScrollView,
  Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications'; // 🟢 ADDED FOR SILENT BADGES
import { useHighAccuracyLocation } from '../hooks/useHighAccuracyLocation';
import { apiClient, BASE_URL } from '../services/api';

// 🟢 FIX 1: Add the missing TS properties to suppress the error
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true, 
    shouldShowList: true, 
  }),
});

interface NearbyDrop {
  username: string;
  distanceInMeters: number;
  statusMessage: string;
  avatarUrl?: string | null; // 🟢 ADDED FOR AVATARS
}

interface DropsScreenProps {
  onUnreadCountChange?: (count: number) => void;
}

export const DropsScreen: React.FC<DropsScreenProps> = ({ onUnreadCountChange }) => {
  const insets = useSafeAreaInsets();
  const { coords } = useHighAccuracyLocation();

  const [isRadarActive, setIsRadarActive] = useState(true);
  const [drops, setDrops] = useState<NearbyDrop[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string>('');
  
  const shieldKey = process.env.EXPO_PUBLIC_SHIELD_KEY || 'PermanentSecret999';

  const previousCountRef = useRef<number>(0);
  const isMountedRef = useRef<boolean>(true);
  const coordsRef = useRef(coords);
  const flatListRef = useRef<FlatList>(null);
  coordsRef.current = coords;

  useEffect(() => {
    isMountedRef.current = true;
    fetchUserProfile();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let pingInterval: NodeJS.Timeout;

    if (coords && isRadarActive) {
      apiClient
        .post(`/v1/campfire/ping-location?lat=${coords.latitude}&lng=${coords.longitude}`)
        .catch((e) => console.warn('Location ping failed:', e?.message));

      pingInterval = setInterval(() => {
        if (coordsRef.current && isRadarActive) {
          apiClient
            .post(
              `/v1/campfire/ping-location?lat=${coordsRef.current.latitude}&lng=${coordsRef.current.longitude}`
            )
            .catch((e) => console.warn('Location ping failed:', e?.message));
        }
      }, 30000);
    }

    return () => {
      if (pingInterval) clearInterval(pingInterval);
    };
  }, [coords?.latitude, coords?.longitude, isRadarActive]);

  useEffect(() => {
    let scanInterval: NodeJS.Timeout;

    const startScanning = () => {
      if (coordsRef.current && isRadarActive) {
        scanRadar();
        scanInterval = setInterval(() => {
          scanRadar();
        }, 5000);
      }
    };

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        if (!scanInterval) startScanning();
      } else {
        if (scanInterval) clearInterval(scanInterval);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    if (AppState.currentState === 'active') {
      startScanning();
    } else {
      setDrops([]);
      previousCountRef.current = 0;
      if (onUnreadCountChange) onUnreadCountChange(0);
    }

    return () => {
      if (scanInterval) clearInterval(scanInterval);
      subscription.remove();
    };
  }, [coords?.latitude, coords?.longitude, isRadarActive]);

  const fetchUserProfile = async () => {
    try {
      const user = await apiClient.get('/v1/auth/me');
      if (user?.username && isMountedRef.current) {
        setCurrentUsername(user.username);
      }
    } catch (e) {
      console.warn('Could not fetch user profile');
    }
  };

  const getSecureImageSource = (uri: string) => {
    if (Platform.OS === 'web' || uri.includes('amazonaws.com')) return { uri };
    return { 
      uri, 
      headers: { 'X-Ghost-Shield-Key': shieldKey } 
    };
  };

  const scanRadar = async () => {
    if (!coordsRef.current || !isRadarActive) return;

    try {
      const response: NearbyDrop[] = await apiClient.get(
        `/v1/campfire/scan?lat=${coordsRef.current.latitude}&lng=${coordsRef.current.longitude}`
      );

      if (!isMountedRef.current) return;

      const freshDrops = response || [];
      
      // 🟢 FIX 2: Fetch avatars for AirDrop users
      const dropsWithAvatars = await Promise.all(
        freshDrops.map(async (drop) => {
          try {
            const profileRes = await apiClient.get(`/v1/p2p/profile/${drop.username}`);
            let rawPic = profileRes.avatarUrl || profileRes.profilePictureUrl || null;
            if (rawPic && !rawPic.startsWith('http')) {
              const cleanBase = BASE_URL.replace(/\/$/, '');
              const cleanPath = rawPic.replace(/^\//, '');
              rawPic = `${cleanBase}/${cleanPath}`;
            }
            return { ...drop, avatarUrl: rawPic };
          } catch {
            return { ...drop, avatarUrl: null };
          }
        })
      );

      setDrops(dropsWithAvatars);

      if (freshDrops.length !== previousCountRef.current) {
        // 🟢 FIX 3: Silent notification (just updates the badge dot like WhatsApp)
        if (freshDrops.length > previousCountRef.current) {
          Notifications.setBadgeCountAsync(freshDrops.length);
        }
        
        previousCountRef.current = freshDrops.length;
        if (onUnreadCountChange) {
          onUnreadCountChange(freshDrops.length);
        }
      }
    } catch (e: any) {
      console.warn('Radar scan paused:', e?.message || '');
    }
  };

  const handleToggleRadar = (value: boolean) => {
    setIsRadarActive(value);
    if (!value) {
      setDrops([]);
      previousCountRef.current = 0;
      if (onUnreadCountChange) onUnreadCountChange(0);
      Notifications.setBadgeCountAsync(0); // Clear badge when radar is off
    }
  };

  const handlePostDrop = async () => {
    if (!isRadarActive || !message.trim()) return;
    if (!coordsRef.current) {
      Alert.alert('Acquiring Location', 'Obtaining precise GPS location...');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/v1/campfire/drop', {
        latitude: coordsRef.current.latitude,
        longitude: coordsRef.current.longitude,
        statusMessage: message.trim(),
      });

      if (isMountedRef.current) setMessage('');
      await scanRadar();
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (e: any) {
      const serverErrorMessage =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        'Could not post drop.';
      Alert.alert('AirDrop Notice', serverErrorMessage, [{ text: 'OK' }]);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  const handleReportUser = (username: string) => {
    if (username === currentUsername) return;

    Alert.alert(
      'Report AirDrop',
      `Report @${username}? 5 reports will permanently block this user.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.post(`/v1/campfire/report/${username}`);
              Alert.alert('Reported', `@${username} reported.`);
              await scanRadar();
            } catch (e: any) {
              Alert.alert('Report Error', e?.response?.data?.message || 'Could not report.');
            }
          },
        },
      ]
    );
  };

  const handleRefresh = async () => {
    if (!isRadarActive) return;
    setRefreshing(true);
    await scanRadar();
    if (isMountedRef.current) setRefreshing(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View>
          <Text style={styles.title}>AirDrops</Text>
          <Text style={styles.subtitle}>
            {isRadarActive
              ? coords
                ? `Radar Active • 50m Radius`
                : 'Acquiring GPS...'
              : 'Radar Disabled'}
          </Text>
        </View>

        <View style={styles.switchContainer}>
          <Text style={styles.switchLabel}>{isRadarActive ? 'ON' : 'OFF'}</Text>
          <Switch
            value={isRadarActive}
            onValueChange={handleToggleRadar}
            trackColor={{ false: '#262626', true: '#404040' }}
            thumbColor={isRadarActive ? '#FFFFFF' : '#737373'}
          />
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {!isRadarActive || drops.length === 0 ? (
          <ScrollView 
            contentContainerStyle={styles.emptyScrollContainer}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="#FFFFFF"
                enabled={isRadarActive}
              />
            }
          >
            <View style={styles.emptyContainer}>
              <Feather
                name={isRadarActive ? 'radio' : 'power'}
                size={32}
                color="#404040"
                style={{ marginBottom: 12 }}
              />
              <Text style={styles.emptyText}>
                {isRadarActive ? 'No AirDrops nearby (50m)' : 'AirDrop is turned off'}
              </Text>
              <Text style={styles.emptySubText}>
                {isRadarActive
                  ? 'Type below to drop a message in this area.'
                  : 'Toggle the switch at top right to start receiving local drops.'}
              </Text>
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={flatListRef}
            data={drops}
            keyExtractor={(item, index) => `${item.username}-${index}`}
            contentContainerStyle={styles.listContent}
            inverted
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="#FFFFFF"
                enabled={isRadarActive}
              />
            }
            renderItem={({ item }) => {
              const cleanItemUsername = item.username.replace(/^@/, '').trim().toLowerCase();
              const cleanCurrentUsername = currentUsername.replace(/^@/, '').trim().toLowerCase();

              const isSelf =
                cleanItemUsername === cleanCurrentUsername && cleanCurrentUsername.length > 0;

              return (
                <View style={[styles.messageRow, isSelf ? styles.messageRowSelf : styles.messageRowOther]}>
                  {!isSelf && (
                    <View style={[styles.bubble, styles.bubbleOther]}>
                      
                      {/* 🟢 AVATAR RENDERED HERE IN BUBBLE HEADER */}
                      <View style={styles.bubbleHeader}>
                        {item.avatarUrl ? (
                          <Image 
                            source={getSecureImageSource(item.avatarUrl)} 
                            style={styles.airdropAvatarImage} 
                          />
                        ) : (
                          <View style={styles.airdropAvatarFallback}>
                            <Text style={styles.airdropAvatarText}>{item.username[0]?.toUpperCase()}</Text>
                          </View>
                        )}
                        <Text style={styles.senderName}>@{item.username}</Text>
                        <Text style={styles.distanceMeta}>• {item.distanceInMeters}m</Text>
                      </View>

                      <Text style={styles.messageText}>{item.statusMessage}</Text>
                    </View>
                  )}

                  {!isSelf && (
                    <TouchableOpacity
                      style={styles.reportIcon}
                      onPress={() => handleReportUser(item.username)}
                    >
                      <Feather name="flag" size={14} color="#404040" />
                    </TouchableOpacity>
                  )}

                  {isSelf && (
                    <View style={[styles.bubble, styles.bubbleSelf]}>
                      <Text style={styles.messageText}>{item.statusMessage}</Text>
                    </View>
                  )}
                </View>
              );
            }}
          />
        )}
      </View>

      <View style={[styles.bottomInputContainer, { paddingBottom: Math.max(12, insets.bottom) }]}>
        <TextInput
          style={styles.bottomInput}
          placeholder={isRadarActive ? 'Drop a message nearby...' : 'Turn on radar to send drops'}
          placeholderTextColor="#525252"
          value={message}
          onChangeText={setMessage}
          editable={isRadarActive && !loading}
          maxLength={150}
          multiline
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            (!isRadarActive || !message.trim()) && styles.sendButtonDisabled,
          ]}
          onPress={handlePostDrop}
          disabled={!isRadarActive || !message.trim() || loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#000000" />
          ) : (
            <Feather
              name="arrow-up"
              size={18}
              color={isRadarActive && message.trim() ? '#000000' : '#525252'}
            />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#171717',
    backgroundColor: '#000000',
    zIndex: 10,
  },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: '#737373', fontSize: 11, fontWeight: '600', marginTop: 2 },
  switchContainer: { flexDirection: 'row', alignItems: 'center' },
  switchLabel: { color: '#A3A3A3', fontSize: 11, fontWeight: '800', marginRight: 8 },
  
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 },
  emptyScrollContainer: { flexGrow: 1, justifyContent: 'center' },
  emptyContainer: { alignItems: 'center', paddingHorizontal: 32 },
  emptyText: { color: '#A3A3A3', fontSize: 15, fontWeight: '700' },
  emptySubText: { color: '#525252', fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18 },

  messageRow: {
    flexDirection: 'row',
    marginBottom: 16,
    alignItems: 'flex-end',
  },
  messageRowSelf: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  bubbleSelf: {
    backgroundColor: '#262626',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: '#121212', 
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#1F1F1F',
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center', // 🟢 Changed to center to align with avatar
    marginBottom: 6,
  },
  // 🟢 Styles for AirDrop Avatars
  airdropAvatarImage: { width: 22, height: 22, borderRadius: 11, marginRight: 8, backgroundColor: '#262626' },
  airdropAvatarFallback: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  airdropAvatarText: { color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' },
  
  senderName: {
    color: '#A3A3A3',
    fontSize: 12,
    fontWeight: '700',
  },
  distanceMeta: {
    color: '#525252',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 6,
  },
  messageText: {
    color: '#E5E5E5',
    fontSize: 15,
    lineHeight: 20,
  },
  reportIcon: {
    marginLeft: 8,
    marginBottom: 8,
    padding: 4,
  },

  bottomInputContainer: {
    backgroundColor: '#000000',
    borderTopWidth: 1,
    borderTopColor: '#171717',
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  bottomInput: {
    flex: 1,
    backgroundColor: '#121212',
    color: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#262626',
    marginRight: 10,
    minHeight: 40,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 2, 
  },
  sendButtonDisabled: {
    backgroundColor: '#1A1A1A',
  },
});