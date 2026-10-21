import 'react-native-get-random-values'; 
import 'text-encoding-polyfill';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast, { BaseToast, ErrorToast } from 'react-native-toast-message'; 
import * as Notifications from 'expo-notifications'; 

import { ThemeProvider, useTheme } from './src/context/ThemeContext'; // 🟢 Global Theme Wrapper

import SinglePostScreen from './src/screens/SinglePostScreen';
import AuthScreen from './src/screens/AuthScreen';
import TabNavigator from './src/navigation/TabNavigator';
import GossipsChatScreen from './src/screens/GossipsChatScreen';
import PublicProfileScreen from './src/screens/PublicProfileScreen'; 
import BlockedUsersScreen from './src/screens/BlockedUsersScreen'; 
import PremiumUpgradeScreen from './src/screens/PremiumUpgradeScreen'; 

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

// 🟢 FIX: Beautiful, Theme-Aware Toasts component wrapper
const ThemedToast = () => {
  const { colors, isDarkMode } = useTheme();

  const toastConfig = {
    success: (props: any) => (
      <BaseToast
        {...props}
        style={{ borderLeftColor: '#34C759', backgroundColor: colors.surface, borderRadius: 12, borderWidth: isDarkMode ? 1 : 0, borderColor: colors.border, width: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 }}
        contentContainerStyle={{ paddingHorizontal: 15 }}
        text1Style={{ fontSize: 14, fontWeight: '800', color: colors.text }}
        text2Style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted }}
      />
    ),
    error: (props: any) => (
      <ErrorToast
        {...props}
        style={{ borderLeftColor: colors.danger, backgroundColor: colors.surface, borderRadius: 12, borderWidth: isDarkMode ? 1 : 0, borderColor: colors.border, width: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 }}
        contentContainerStyle={{ paddingHorizontal: 15 }}
        text1Style={{ fontSize: 14, fontWeight: '800', color: colors.text }}
        text2Style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted }}
      />
    ),
    info: (props: any) => (
      <BaseToast
        {...props}
        style={{ borderLeftColor: colors.primary, backgroundColor: colors.surface, borderRadius: 12, borderWidth: isDarkMode ? 1 : 0, borderColor: colors.border, width: '90%', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 }}
        contentContainerStyle={{ paddingHorizontal: 15 }}
        text1Style={{ fontSize: 14, fontWeight: '800', color: colors.text }}
        text2Style={{ fontSize: 12, fontWeight: '600', color: colors.textMuted }}
      />
    )
  };

  return <Toast config={toastConfig} />;
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
      <ThemeProvider> 
        <NavigationContainer linking={linking}>
          {isAuthenticated && activeUser ? (
            <GlobalNetworkManager key={activeUser}>
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="MainTabs">
                  {(props) => <TabNavigator {...props} onLogoutTrigger={handleLogoutTrigger} />}
                </Stack.Screen>
                <Stack.Screen name="GossipsChat" component={GossipsChatScreen} />
                <Stack.Screen name="PublicProfile" component={PublicProfileScreen} />
                
                {/* 🟢 SinglePost sits here ABOVE the tabs, so they naturally hide */}
                <Stack.Screen name="SinglePost" component={SinglePostScreen} />
                
                <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
                <Stack.Screen name="PremiumUpgrade" component={PremiumUpgradeScreen} />
              </Stack.Navigator>
            </GlobalNetworkManager>
          ) : (
            <AuthScreen onAuthSuccess={handleAuthSuccess} />
          )}
        </NavigationContainer>
        
        {/* 🟢 Themed Toasts Root Injector */}
        <ThemedToast /> 
      </ThemeProvider>
    </SafeAreaProvider>
  );
}