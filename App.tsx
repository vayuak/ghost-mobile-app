import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View } from 'react-native';

// Import your screens and navigators
import AuthScreen from './src/screens/AuthScreen';
import TabNavigator from './src/navigation/TabNavigator';

// 🟢 DEEP LINKING CONFIGURATION
// This tells React Navigation how to translate incoming URLs into screens
const linking = {
  prefixes: [Linking.createURL('/'), 'ghostshield://'],
  config: {
    screens: {
      // If a user clicks 'ghostshield://home', it maps to the Home tab
      Home: 'home',
      
      // If a user clicks 'ghostshield://chat', it jumps to the Gossips tab
      Gossips: 'chat',
      
      // If a user clicks 'ghostshield://profile', it jumps to their Profile
      Profile: 'profile',
      
      // Note: When you eventually build a standalone post view screen, 
      // you will add it here like: SinglePostScreen: 'post/:postId'
    },
  },
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);

  // Check if the user is already logged in on app launch
  useEffect(() => {
    const verifySession = async () => {
      try {
        const token = await AsyncStorage.getItem('@ghost_token');
        if (token) {
          setIsAuthenticated(true);
        }
      } catch (error) {
        console.error("Session verification failed:", error);
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
    // Purge local identity footprint
    await AsyncStorage.removeItem('@ghost_token');
    await AsyncStorage.removeItem('@active_username');
    await AsyncStorage.removeItem('@user_avatar');
    setIsAuthenticated(false);
  };

  // Prevent app from rendering navigation before session state is known
  if (isInitializing) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000000', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#666666" />
      </View>
    );
  }

  return (
    // 🟢 Inject the linking configuration into the NavigationContainer
    <NavigationContainer linking={linking}>
      {isAuthenticated ? (
        <TabNavigator onLogoutTrigger={handleLogoutTrigger} />
      ) : (
        <AuthScreen onAuthSuccess={handleAuthSuccess} />
      )}
    </NavigationContainer>
  );
}