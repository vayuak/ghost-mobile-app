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

import SinglePostScreen from './src/screens/SinglePostScreen';
import AuthScreen from './src/screens/AuthScreen';
import TabNavigator from './src/navigation/TabNavigator';
import GossipsChatScreen from './src/screens/GossipsChatScreen';
import PublicProfileScreen from './src/screens/PublicProfileScreen'; 

import { initLocalDatabase } from './src/services/LocalDB';
import { ensureKeysPublished } from './src/services/CryptoVault';
import { GlobalNetworkManager } from './src/services/GlobalNetworkManager';

const HTTPS_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://sandbag-sterling-leggings.ngrok-free.dev';

const Stack = createNativeStackNavigator();

// 🟢 THIS IS THE CRITICAL DEEP LINKING CONFIGURATION
const linking: any = {
  prefixes: [
    Linking.createURL('/'), 
    'glider://', 
    HTTPS_URL 
  ],
  config: {
    screens: {
      MainTabs: {
        screens: { Home: 'home', Gossips: 'chat', Profile: 'profile' }
      },
      GossipsChat: 'dm/:targetUser',
      PublicProfile: 'user/:targetUser',
      SinglePost: 'post/:postId', 
    },
  },
};

const toastConfig = {
  info: (props: any) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: '#34C759', backgroundColor: '#1A1A1A', borderRadius: 12, borderLeftWidth: 4, width: '90%' }}
      contentContainerStyle={{ paddingHorizontal: 15 }}
      text1Style={{ fontSize: 15, fontWeight: 'bold', color: '#FFF' }}
      text2Style={{ fontSize: 13, color: '#A3A3A3' }}
    />
  ),
  success: (props: any) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: '#00C851', backgroundColor: '#1A1A1A' }}
      text1Style={{ color: '#FFF' }}
      text2Style={{ color: '#A3A3A3' }}
    />
  ),
  error: (props: any) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: '#FF4444', backgroundColor: '#1A1A1A' }}
      text1Style={{ color: '#FFF' }}
      text2Style={{ color: '#A3A3A3' }}
    />
  )
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  useEffect(() => {
    const verifySession = async () => {
      try {
        if (Platform.OS !== 'web') {
          const { status } = await Notifications.getPermissionsAsync();
          if (status !== 'granted') {
            await Notifications.requestPermissionsAsync();
          }
        }

        initLocalDatabase();
        const token = await AsyncStorage.getItem('@ghost_token');
        if (token) {
          setIsAuthenticated(true);
          await ensureKeysPublished();
        }
      } catch (error) {
        console.error("Session/DB verification failed:", error);
      } finally {
        setIsInitializing(false);
      }
    };
    verifySession();
  }, []);

  const handleAuthSuccess = async () => {
    setIsAuthenticated(true);
    await ensureKeysPublished();
  };

  const handleLogoutTrigger = async () => {
    await AsyncStorage.multiRemove(['@ghost_token', '@active_username', '@user_avatar']);
    setIsAuthenticated(false);
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
      <NavigationContainer linking={linking}>
        {isAuthenticated ? (
          <GlobalNetworkManager>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="MainTabs">
                {(props) => <TabNavigator {...props} onLogoutTrigger={handleLogoutTrigger} />}
              </Stack.Screen>
              <Stack.Screen name="GossipsChat">
                {(props) => <GossipsChatScreen {...props} />}
              </Stack.Screen>
              <Stack.Screen name="PublicProfile">
                {(props) => <PublicProfileScreen {...props} />}
              </Stack.Screen>
              <Stack.Screen name="SinglePost">
                {(props) => <SinglePostScreen {...props} />}
              </Stack.Screen>
            </Stack.Navigator>
          </GlobalNetworkManager>
        ) : (
          <AuthScreen onAuthSuccess={handleAuthSuccess} />
        )}
      </NavigationContainer>
      <Toast config={toastConfig} /> 
    </SafeAreaProvider>
  );
}