import 'react-native-get-random-values'; // 🟢 CRITICAL: Must be the absolute first line!
import 'text-encoding';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View } from 'react-native';

// Import your screens and navigators
import AuthScreen from './src/screens/AuthScreen';
import TabNavigator from './src/navigation/TabNavigator';
import GossipsChatScreen from './src/screens/GossipsChatScreen';

// 🟢 CRITICAL: Import your DB init function here
import { initLocalDatabase } from './src/services/LocalDB';

const Stack = createNativeStackNavigator();

const linking: any = {
  prefixes: [Linking.createURL('/'), 'ghostshield://'],
  config: {
    screens: {
      MainTabs: {
        screens: {
          Home: 'home',
          Gossips: 'chat',
          Profile: 'profile',
        }
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
        // 🟢 FIX: Initialize the database safely AFTER the app is mounted!
        initLocalDatabase();

        const token = await AsyncStorage.getItem('@ghost_token');
        if (token) {
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error("Session/DB verification failed:", error);
      } finally {
        setIsInitializing(false);
      }
    };

    verifySession();
  }, []);

  const handleAuthSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogoutTrigger = async () => {
    await AsyncStorage.removeItem('@ghost_token');
    await AsyncStorage.removeItem('@active_username');
    await AsyncStorage.removeItem('@user_avatar');
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
    <NavigationContainer linking={linking}>
      {isAuthenticated ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="MainTabs">
            {(props) => <TabNavigator {...props} onLogoutTrigger={handleLogoutTrigger} />}
          </Stack.Screen>
          <Stack.Screen name="GossipsChat" component={GossipsChatScreen} />
        </Stack.Navigator>
      ) : (
        <AuthScreen onAuthSuccess={handleAuthSuccess} />
      )}
    </NavigationContainer>
  );
}