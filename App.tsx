import 'react-native-get-random-values';
import 'text-encoding-polyfill';
import React, { useState, useEffect, useRef } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast, { BaseToast, ErrorToast } from 'react-native-toast-message';
import * as Notifications from 'expo-notifications';

import { ThemeProvider, useTheme } from './src/context/ThemeContext';

import SinglePostScreen from './src/screens/SinglePostScreen';
import AuthScreen from './src/screens/AuthScreen';
import TabNavigator from './src/navigation/TabNavigator';
import GossipsChatScreen from './src/screens/GossipsChatScreen';
import PublicProfileScreen from './src/screens/PublicProfileScreen';
import BlockedUsersScreen from './src/screens/BlockedUsersScreen';

import { initLocalDatabase } from './src/services/LocalDB';
import { ensureKeysPublished } from './src/services/CryptoVault';
import { GlobalNetworkManager } from './src/services/GlobalNetworkManager';
import { apiClient, API_ROUTES, setSessionExpiredHandler, syncDeviceToken } from './src/services/api';
import { SITE } from './src/constants/links';

const Stack = createNativeStackNavigator();

// Website share links (https://www.warnpack.com/post/123) open the app via Android App Links.
const linking: any = {
  prefixes: [Linking.createURL('/'), 'warnpack://', SITE],
  config: {
    screens: {
      MainTabs: { screens: { Home: 'home', AirDrop: 'airdrop', Gossips: 'chat', Profile: 'profile' } },
      GossipsChat: 'dm/:targetUser',
      PublicProfile: 'user/:targetUser',
      SinglePost: 'post/:postId',
    },
  },
};

// Foreground push notification behaviour (single place for the whole app)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const ThemedToast = () => {
  const { colors, isDarkMode } = useTheme();

  const base = { backgroundColor: colors.surface, borderRadius: 12, borderWidth: isDarkMode ? 1 : 0, borderColor: colors.border, width: '90%' as const, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 };
  const t1 = { fontSize: 14, fontWeight: '800' as const, color: colors.text };
  const t2 = { fontSize: 12, fontWeight: '600' as const, color: colors.textMuted };

  const toastConfig = {
    success: (props: any) => <BaseToast {...props} style={{ ...base, borderLeftColor: '#34C759' }} contentContainerStyle={{ paddingHorizontal: 15 }} text1Style={t1} text2Style={t2} />,
    error: (props: any) => <ErrorToast {...props} style={{ ...base, borderLeftColor: colors.danger }} contentContainerStyle={{ paddingHorizontal: 15 }} text1Style={t1} text2Style={t2} />,
    info: (props: any) => <BaseToast {...props} style={{ ...base, borderLeftColor: colors.primary }} contentContainerStyle={{ paddingHorizontal: 15 }} text1Style={t1} text2Style={t2} />,
  };

  return <Toast config={toastConfig} />;
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [activeUser, setActiveUser] = useState<string>('');
  const navigationRef = useRef<NavigationContainerRef<any>>(null);

  // When the server says the session is dead (expired token, deleted/blocked account) show the login screen.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setIsAuthenticated(false);
      setActiveUser('');
    });
  }, []);

  useEffect(() => {
    const verifySession = async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('messages', {
            name: 'Messages',
            importance: Notifications.AndroidImportance.HIGH,
            sound: 'default',
          });
        }

        initLocalDatabase();
        const token = await AsyncStorage.getItem('@ghost_token');
        const user = await AsyncStorage.getItem('@active_username');

        if (token && user) {
          let valid = true;
          try {
            // Throws (and clears the session) on 401/403 - a stored token is not proof that the session is still valid.
            await apiClient.get(API_ROUTES.AUTH.ME);
          } catch (e: any) {
            const msg = String(e?.message || '');
            // Offline / slow network: keep the user signed in and let the app work from local data.
            valid = !(msg.includes('Session expired') || msg.includes('does not have permission'));
          }
          if (valid) {
            setActiveUser(user);
            setIsAuthenticated(true);
            ensureKeysPublished().catch(() => {});
            syncDeviceToken().catch(() => {});
          } else {
            await AsyncStorage.multiRemove(['@ghost_token', '@active_username', '@user_avatar']);
          }
        }
      } catch (error) {
        console.error('Session verification failed:', error);
      } finally {
        setIsInitializing(false);
      }
    };
    verifySession();
  }, []);

  // Tapping a push notification opens the right screen
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data: any = response.notification.request.content.data;

      if (data?.route === 'Chat' && data?.username) {
        navigationRef.current?.navigate('GossipsChat', { targetUser: data.username });
      } else if (data?.route === 'Campfire') {
        navigationRef.current?.navigate('MainTabs', { screen: 'AirDrop' });
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const handleAuthSuccess = async () => {
    const user = await AsyncStorage.getItem('@active_username');
    if (user) setActiveUser(user);
    setIsAuthenticated(true);
    ensureKeysPublished().catch(() => {});
    syncDeviceToken().catch(() => {});
  };

  const handleLogoutTrigger = async () => {
    await AsyncStorage.multiRemove(['@ghost_token', '@active_username', '@user_avatar']);
    setIsAuthenticated(false);
    setActiveUser('');
  };

  if (isInitializing) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#666666" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <NavigationContainer ref={navigationRef} linking={linking}>
          {isAuthenticated && activeUser ? (
            <GlobalNetworkManager key={activeUser}>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="MainTabs">
                  {(props) => <TabNavigator {...props} onLogoutTrigger={handleLogoutTrigger} />}
                </Stack.Screen>
                <Stack.Screen name="GossipsChat" component={GossipsChatScreen} />
                <Stack.Screen name="PublicProfile" component={PublicProfileScreen} />
                <Stack.Screen name="SinglePost" component={SinglePostScreen} />
                <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
              </Stack.Navigator>
            </GlobalNetworkManager>
          ) : (
            <AuthScreen onAuthSuccess={handleAuthSuccess} />
          )}
        </NavigationContainer>
        <ThemedToast />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
