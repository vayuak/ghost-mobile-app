import 'text-encoding';
import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack'; // 🟢 1. Import Stack
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, View } from 'react-native';

// Import your screens and navigators
import AuthScreen from './src/screens/AuthScreen';
import TabNavigator from './src/navigation/TabNavigator';
import GossipsChatScreen from './src/screens/GossipsChatScreen'; // 🟢 2. Import Chat Screen

const Stack = createNativeStackNavigator(); // 🟢 3. Initialize Stack

// 🟢 DEEP LINKING CONFIGURATION
const linking :any= {
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
    // 🟢 FIX 2: Pass the variable normally. Remove the ":any" from the prop name!
    <NavigationContainer linking={linking}>
      {isAuthenticated ? (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          
          {/* Base Layer: The Tab Bar */}
          <Stack.Screen name="MainTabs">
            {(props) => <TabNavigator {...props} onLogoutTrigger={handleLogoutTrigger} />}
          </Stack.Screen>
          
          {/* Top Layer: Full Screen Chat */}
          <Stack.Screen name="GossipsChat" component={GossipsChatScreen} />
          
        </Stack.Navigator>
      ) : (
        <AuthScreen onAuthSuccess={handleAuthSuccess} />
      )}
    </NavigationContainer>
  );
}