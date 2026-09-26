import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  Alert, ActivityIndicator, RefreshControl, Switch, AppState,
  AppStateStatus, ScrollView, Image, Platform 
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications'; 
import { useHighAccuracyLocation } from '../hooks/useHighAccuracyLocation';
import { apiClient, API_ROUTES, BASE_URL } from '../services/api'; 
import { peekAvatarUrl, preloadAvatars } from '../services/ProfileCache'; 

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true, 
    shouldShowList: true, 
  }),
});

async function notifyNewDrop(username: string, distance: number) {
  if (Platform.OS === 'web') return; 

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "New AirDrop Nearby 📍",
      body: `@${username} ${distance}m away wants to say something.`,
      sound: true,
    },
    trigger: null, 
  });
}

interface NearbyDrop {
  username: string;
  distanceInMeters: number;
  statusMessage: string;
  avatarUrl?: string | null; 
  createdAt?: string | number;
  isSafeText?: boolean; 
}

interface DropsScreenProps {
  onUnreadCountChange?: (count: number) => void;
  navigation?: any; 
}

const DropContent = ({ drop, isSelf }: { drop: NearbyDrop, isSelf: boolean }) => {
  const [isRevealed, setIsRevealed] = useState(
    isSelf || drop.isSafeText !== false
  );

  if (!isRevealed) {
    return (
      <TouchableOpacity 
        style={styles.warningBox} 
        activeOpacity={0.7} 
        onPress={() => setIsRevealed(true)}
      >
        <Feather name="eye-off" size={18} color="#FBBF24" />
        <Text style={styles.warningTitle}>Unverified Content</Text>
        <Text style={styles.warningSubText}>AI scan timed out. Tap to view.</Text>
      </TouchableOpacity>
    );
  }

  return <Text style={styles.messageText}>{drop.statusMessage}</Text>;
};

export const DropsScreen: React.FC<DropsScreenProps> = ({ onUnreadCountChange, navigation }) => {
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

  useEffect(() => {
    isMountedRef.current = true;
    fetchUserProfile();
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    let pingInterval: NodeJS.Timeout;
    if (coords && isRadarActive) {
      apiClient.post(`${API_ROUTES.CAMPFIRE.PING_LOCATION}?lat=${coords.latitude}&lng=${coords.longitude}`).catch(() => {});
      pingInterval = setInterval(() => {
        if (coordsRef.current && isRadarActive) {
          apiClient.post(`${API_ROUTES.CAMPFIRE.PING_LOCATION}?lat=${coordsRef.current.latitude}&lng=${coordsRef.current.longitude}`).catch(() => {});
        }
      }, 30000);
    }
    return () => { if (pingInterval) clearInterval(pingInterval); };
  }, [coords?.latitude, coords?.longitude, isRadarActive]);

  useEffect(() => {
    let scanInterval: NodeJS.Timeout;
    const startScanning = () => {
      if (coordsRef.current && isRadarActive) {
        scanRadar();
        scanInterval = setInterval(() => { scanRadar(); }, 5000);
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
      const user = await apiClient.get(API_ROUTES.AUTH.ME);
      if (user?.username && isMountedRef.current) {
        setCurrentUsername(user.username);
      }
    } catch (e) { }
  };

  // 🟢 SAFELY FORMATS AVATARS
  const getSecureImageSource = (uri: string) => { 
      const cleanUrl = uri.startsWith('http') ? uri : `${BASE_URL}${uri.startsWith('/') ? uri : `/${uri}`}`;
      return { uri: cleanUrl }; 
  };

  const scanRadar = async () => {
    if (!coordsRef.current || !isRadarActive) return;

    try {
      const response: NearbyDrop[] = await apiClient.get(
        `${API_ROUTES.CAMPFIRE.SCAN}?lat=${coordsRef.current.latitude}&lng=${coordsRef.current.longitude}`
      );

      if (!isMountedRef.current) return;
      const freshDrops = response || [];

      const usernames = freshDrops.map((drop) => drop.username);
      preloadAvatars(usernames);

      const dropsWithAvatars = freshDrops.map((drop) => {
        return { ...drop, avatarUrl: peekAvatarUrl(drop.username) };
      });

      const sortedDrops = dropsWithAvatars.sort((a, b) => {
        if (a.createdAt && b.createdAt) {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        return 0; 
      });

      setDrops(sortedDrops);

      if (freshDrops.length !== previousCountRef.current) {
        if (freshDrops.length > previousCountRef.current) {
          if (Platform.OS !== 'web') {
            Notifications.setBadgeCountAsync(freshDrops.length);
          }
          
          const newestDrop = sortedDrops[0];
          if (newestDrop && newestDrop.username !== currentUsername) {
            notifyNewDrop(newestDrop.username, newestDrop.distanceInMeters);
          }
        }
        
        previousCountRef.current = freshDrops.length;
        if (onUnreadCountChange) onUnreadCountChange(freshDrops.length);
      }
    } catch (e: any) { }
  };

  const handleToggleRadar = (value: boolean) => {
    setIsRadarActive(value);
    if (!value) {
      setDrops([]);
      previousCountRef.current = 0;
      if (onUnreadCountChange) onUnreadCountChange(0);
      if (Platform.OS !== 'web') {
        Notifications.setBadgeCountAsync(0); 
      }
    }
  };

  const handlePostDrop = async () => {
    if (!isRadarActive || !message.trim()) return;
    if (!coordsRef.current) {
      Alert.alert('Acquiring Location', 'Obtaining precise GPS location...');
      return;
    }
    
    const tempMessage = message.trim();
    setMessage(''); 
    
    const optimisticDrop: NearbyDrop = {
      username: currentUsername,
      distanceInMeters: 0,
      statusMessage: tempMessage,
      avatarUrl: peekAvatarUrl(currentUsername), 
      createdAt: new Date().toISOString(),
      isSafeText: true, 
    };

    setDrops((prev) => [optimisticDrop, ...prev]);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });

    try {
      await apiClient.post(API_ROUTES.CAMPFIRE.DROP, {
        latitude: coordsRef.current.latitude,
        longitude: coordsRef.current.longitude,
        statusMessage: tempMessage,
      });
      scanRadar(); 
    } catch (e: any) {
      setDrops((prev) => prev.filter((d) => d !== optimisticDrop));
      setMessage(tempMessage);

      const errorMessage = e?.response?.data?.message || e?.message || 'Network disconnected. Could not post drop.';

      if (errorMessage.toLowerCase().includes('limit')) {
        Alert.alert(
          'Out of AirDrops 🎈',
          'You have used all 10 free AirDrops for today. Upgrade to Premium for unlimited drops!',
          [
            { text: 'Wait for reset', style: 'cancel' },
            { 
              text: 'Get Premium', 
              onPress: () => navigation?.navigate('PremiumSubscription') 
            }
          ]
        );
      } else {
        Alert.alert('AirDrop Failed', errorMessage, [{ text: 'OK' }]);
      }
    }
  };

  const handleReportUser = (username: string) => {
    if (username === currentUsername) return;
    Alert.alert(
      'Report AirDrop',
      `Report @${username}? 3 reports will permanently block this user.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiClient.post(API_ROUTES.CAMPFIRE.REPORT(username));
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
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View>
          <Text style={styles.title}>AirDrops</Text>
          <Text style={styles.subtitle}>
            {isRadarActive ? coords ? `Radar Active • 50m Radius` : 'Acquiring GPS...' : 'Radar Disabled'}
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

      <View style={styles.topInputContainer}>
        <TextInput
          style={styles.topInput}
          placeholder={isRadarActive ? 'Drop a message nearby...' : 'Turn on radar to send drops'}
          placeholderTextColor="#525252"
          value={message}
          onChangeText={setMessage}
          editable={isRadarActive}
          maxLength={150}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, (!isRadarActive || !message.trim()) && styles.sendButtonDisabled]}
          onPress={handlePostDrop}
          disabled={!isRadarActive || !message.trim()}
        >
          <Feather name="arrow-down" size={18} color={isRadarActive && message.trim() ? '#000000' : '#525252'} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {!isRadarActive || drops.length === 0 ? (
          <ScrollView 
            contentContainerStyle={styles.emptyScrollContainer}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FFFFFF" enabled={isRadarActive} />}
          >
            <View style={styles.emptyContainer}>
              <Feather name={isRadarActive ? 'radio' : 'power'} size={32} color="#404040" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>{isRadarActive ? 'No AirDrops nearby (50m)' : 'AirDrop is turned off'}</Text>
              <Text style={styles.emptySubText}>
                {isRadarActive ? 'Type above to drop a message in this area.' : 'Toggle the switch at top right to start receiving local drops.'}
              </Text>
            </View>
          </ScrollView>
        ) : (
          <FlatList
            ref={flatListRef}
            data={drops}
            keyExtractor={(item, index) => `${item.username}-${index}`}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FFFFFF" enabled={isRadarActive} />}
            renderItem={({ item }) => {
              const cleanItemUsername = item.username.replace(/^@/, '').trim().toLowerCase();
              const cleanCurrentUsername = currentUsername.replace(/^@/, '').trim().toLowerCase();
              const isSelf = cleanItemUsername === cleanCurrentUsername && cleanCurrentUsername.length > 0;

              return (
                <View style={[styles.messageRow, isSelf ? styles.messageRowSelf : styles.messageRowOther]}>
                  {!isSelf && (
                    <View style={[styles.bubble, styles.bubbleOther]}>
                      <View style={styles.bubbleHeader}>
                        {item.avatarUrl ? (
                          <Image source={getSecureImageSource(item.avatarUrl)} style={styles.airdropAvatarImage} />
                        ) : (
                          <View style={styles.airdropAvatarFallback}>
                            <Text style={styles.airdropAvatarText}>{item.username[0]?.toUpperCase()}</Text>
                          </View>
                        )}
                        <Text style={styles.senderName}>@{item.username}</Text>
                        <Text style={styles.distanceMeta}>• {item.distanceInMeters}m</Text>
                      </View>
                      
                      <DropContent drop={item} isSelf={isSelf} />

                    </View>
                  )}
                  {!isSelf && (
                    <TouchableOpacity style={styles.reportIcon} onPress={() => handleReportUser(item.username)}>
                      <Feather name="flag" size={14} color="#404040" />
                    </TouchableOpacity>
                  )}
                  {isSelf && (
                    <View style={[styles.bubble, styles.bubbleSelf]}>
                      <DropContent drop={item} isSelf={isSelf} />
                    </View>
                  )}
                </View>
              );
            }}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#000000', zIndex: 10 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', letterSpacing: 0.5 },
  subtitle: { color: '#737373', fontSize: 11, fontWeight: '600', marginTop: 2 },
  switchContainer: { flexDirection: 'row', alignItems: 'center' },
  switchLabel: { color: '#A3A3A3', fontSize: 11, fontWeight: '800', marginRight: 8 },
  topInputContainer: { backgroundColor: '#000000', borderBottomWidth: 1, borderBottomColor: '#171717', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 8 },
  topInput: { flex: 1, backgroundColor: '#121212', color: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, fontSize: 15, borderWidth: 1, borderColor: '#262626', marginRight: 10, minHeight: 40, maxHeight: 100 },
  sendButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  sendButtonDisabled: { backgroundColor: '#1A1A1A' },
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16 },
  emptyScrollContainer: { flexGrow: 1, justifyContent: 'center' },
  emptyContainer: { alignItems: 'center', paddingHorizontal: 32 },
  emptyText: { color: '#A3A3A3', fontSize: 15, fontWeight: '700' },
  emptySubText: { color: '#525252', fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  messageRow: { flexDirection: 'row', marginBottom: 16, alignItems: 'flex-start' },
  messageRowSelf: { justifyContent: 'flex-end' },
  messageRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleSelf: { backgroundColor: '#262626', borderTopLeftRadius: 18, borderBottomLeftRadius: 18, borderTopRightRadius: 18, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#121212', borderTopLeftRadius: 18, borderBottomRightRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#1F1F1F' },
  bubbleHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  airdropAvatarImage: { width: 22, height: 22, borderRadius: 11, marginRight: 8, backgroundColor: '#262626' },
  airdropAvatarFallback: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  airdropAvatarText: { color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' },
  senderName: { color: '#A3A3A3', fontSize: 12, fontWeight: '700' },
  distanceMeta: { color: '#525252', fontSize: 10, fontWeight: '600', marginLeft: 6 },
  messageText: { color: '#E5E5E5', fontSize: 15, lineHeight: 20 },
  reportIcon: { marginLeft: 8, marginTop: 8, padding: 4 },
  warningBox: { 
    backgroundColor: '#332701', 
    padding: 10, 
    borderRadius: 8, 
    alignItems: 'center', 
    justifyContent: 'center', 
    borderWidth: 1, 
    borderColor: '#5C4600',
    marginTop: 4 
  },
  warningTitle: { 
    color: '#FBBF24', 
    fontSize: 13, 
    fontWeight: 'bold', 
    marginTop: 4 
  },
  warningSubText: { 
    color: '#FDE68A', 
    fontSize: 11, 
    marginTop: 2 
  },
});