import 'react-native-get-random-values'; 
import 'text-encoding-polyfill';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast, { BaseToast } from 'react-native-toast-message'; 
import * as Notifications from 'expo-notifications'; 

// 🟢 NEW: Theme Provider Import
import { ThemeProvider } from './src/context/ThemeContext';

import SinglePostScreen from './src/screens/SinglePostScreen';
import AuthScreen from './src/screens/AuthScreen';
import TabNavigator from './src/navigation/TabNavigator';
import GossipsChatScreen from './src/screens/GossipsChatScreen';
import PublicProfileScreen from './src/screens/PublicProfileScreen'; 
import BlockedUsersScreen from './src/screens/BlockedUsersScreen'; // 🟢 Wired
import PremiumUpgradeScreen from './src/screens/PremiumUpgradeScreen'; // 🟢 Wired

import { initLocalDatabase } from './src/services/LocalDB';
import { ensureKeysPublished } from './src/services/CryptoVault';
import { GlobalNetworkManager } from './src/services/GlobalNetworkManager';

const HTTPS_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

const Stack = createNativeStackNavigator();

const linking: any = {
  prefixes: [Linking.createURL('/'), 'viacustos://', HTTPS_URL],
  config: {
    screens: {
      MainTabs: { screens: { Home: 'home', Gossips: 'chat', Profile: 'profile' } },
      GossipsChat: 'dm/:targetUser',
      PublicProfile: 'user/:targetUser',
      SinglePost: 'post/:postId', 
    },
  },
};

const toastConfig = {
  info: (props: any) => (
    <BaseToast {...props} style={{ borderLeftColor: '#34C759', backgroundColor: '#1A1A1A', borderRadius: 12, borderLeftWidth: 4, width: '90%' }} contentContainerStyle={{ paddingHorizontal: 15 }} text1Style={{ fontSize: 15, fontWeight: 'bold', color: '#FFF' }} text2Style={{ fontSize: 13, color: '#A3A3A3' }} />
  ),
  success: (props: any) => <BaseToast {...props} style={{ borderLeftColor: '#00C851', backgroundColor: '#1A1A1A' }} text1Style={{ color: '#FFF' }} text2Style={{ color: '#A3A3A3' }} />,
  error: (props: any) => <BaseToast {...props} style={{ borderLeftColor: '#FF4444', backgroundColor: '#1A1A1A' }} text1Style={{ color: '#FFF' }} text2Style={{ color: '#A3A3A3' }} />
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [activeUser, setActiveUser] = useState<string>('');

  useEffect(() => {
    const verifySession = async () => {
      try {
        if (Platform.OS !== 'web') {
          const { status } = await Notifications.getPermissionsAsync();
          if (status !== 'granted') await Notifications.requestPermissionsAsync();
          if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync('messages', { name: 'Messages', importance: Notifications.AndroidImportance.HIGH, sound: 'default' });
          }
        }

        initLocalDatabase();
        const token = await AsyncStorage.getItem('@ghost_token');
        const user = await AsyncStorage.getItem('@active_username');
        
        if (token && user) {
          setActiveUser(user);
          setIsAuthenticated(true);
          await ensureKeysPublished();
        }
      } catch (error) {
        console.error("Session verification failed:", error);
      } finally {
        setIsInitializing(false);
      }
    };
    verifySession();
  }, []);

  const handleAuthSuccess = async () => {
    const user = await AsyncStorage.getItem('@active_username');
    if (user) setActiveUser(user);
    setIsAuthenticated(true);
    await ensureKeysPublished();
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
      <ThemeProvider> {/* 🟢 Global Theme Wrapper */}
        <NavigationContainer linking={linking}>
          {isAuthenticated && activeUser ? (
            <GlobalNetworkManager key={activeUser}>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="MainTabs">
                  {(props) => <TabNavigator {...props} onLogoutTrigger={handleLogoutTrigger} />}
                </Stack.Screen>
                <Stack.Screen name="GossipsChat" component={GossipsChatScreen} />
                <Stack.Screen name="PublicProfile" component={PublicProfileScreen} />
                <Stack.Screen name="SinglePost" component={SinglePostScreen} />
                
                {/* 🟢 NEW SCREENS WIRED HERE */}
                <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
                <Stack.Screen name="PremiumUpgrade" component={PremiumUpgradeScreen} />

              </Stack.Navigator>
            </GlobalNetworkManager>
          ) : (
            <AuthScreen onAuthSuccess={handleAuthSuccess} />
          )}
        </NavigationContainer>
        <Toast config={toastConfig} /> 
      </ThemeProvider>
    </SafeAreaProvider>
  );
}