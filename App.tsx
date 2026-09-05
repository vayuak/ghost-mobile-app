import 'react-native-get-random-values'; // MUST BE FIRST
import 'text-encoding-polyfill';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AuthScreen from './src/screens/AuthScreen';
import TabNavigator from './src/navigation/TabNavigator';
import GossipsChatScreen from './src/screens/GossipsChatScreen';

import { initLocalDatabase } from './src/services/LocalDB';
import { ensureKeysPublished } from './src/services/CryptoVault';

const Stack = createNativeStackNavigator();

const linking: any = {
  prefixes: [Linking.createURL('/'), 'ghostshield://'],
  config: {
    screens: {
      MainTabs: {
        screens: { Home: 'home', Gossips: 'chat', Profile: 'profile' }
      },
      GossipsChat: 'dm/:targetUser',
    },
  },
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  useEffect(() => {
    const verifySession = async () => {
      try {
        initLocalDatabase();
        const token = await AsyncStorage.getItem('@ghost_token');
        if (token) {
          setIsAuthenticated(true);
          // 🟢 Publish keys globally on startup
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
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="MainTabs">
              {(props) => <TabNavigator {...props} onLogoutTrigger={handleLogoutTrigger} />}
            </Stack.Screen>
            <Stack.Screen name="GossipsChat">
              {(props) => <GossipsChatScreen {...props} />}
            </Stack.Screen>
          </Stack.Navigator>
        ) : (
          <AuthScreen onAuthSuccess={handleAuthSuccess} />
        )}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}