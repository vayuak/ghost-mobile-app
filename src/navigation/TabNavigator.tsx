import React, { useState, useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import HomeFeedScreen from '../screens/HomeFeedScreen';
import CreateDirectiveScreen from '../screens/CreateDirectiveScreen';
import ProfileScreen from '../screens/ProfileScreen';
import GossipsInboxScreen from '../screens/GossipsInboxScreen';
import { DropsScreen } from '../screens/DropScreen';
import { getUnreadChatsCount } from '../services/LocalDB';
import { useTheme } from '../context/ThemeContext'; 

const Tab = createBottomTabNavigator();

export default function TabNavigator({ onLogoutTrigger }: { onLogoutTrigger: () => void }) {
  const { colors, isDarkMode } = useTheme();
  const insets = useSafeAreaInsets();
  
  const [unreadChats, setUnreadChats] = useState(0);
  const [unreadDrops, setUnreadDrops] = useState(0);
  const [hasUnreadProfileNotifications] = useState(false);

  useEffect(() => {
    const updateChatBadge = async () => {
      try {
        const me = await AsyncStorage.getItem('@active_username');
        if (me) setUnreadChats(getUnreadChatsCount(me));
      } catch (e) { }
    };
    updateChatBadge(); 
    const subscription = DeviceEventEmitter.addListener('db_chats_updated', updateChatBadge);
    return () => subscription.remove();
  }, []);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          // 🟢 Sleek, frosted minimal tab bar
          backgroundColor: isDarkMode ? 'rgba(0,0,0,0.96)' : 'rgba(255,255,255,0.96)', 
          borderTopColor: colors.border,
          borderTopWidth: isDarkMode ? 0 : 0.5,
          height: 52 + insets.bottom, 
          paddingBottom: insets.bottom, 
          paddingTop: 4, 
          elevation: 0,
          position: 'absolute', // Allows content to scroll underneath beautifully
        },
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginTop: 2 },
        tabBarIcon: ({ color }) => {
          if (route.name === 'Home') return <Feather name="home" size={24} color={color} />;
          if (route.name === 'AirDrop') return <Feather name="radio" size={24} color={color} />;
          if (route.name === 'Create') return <Feather name="plus-square" size={24} color={color} />;
          if (route.name === 'Gossips') return <MaterialCommunityIcons name="message-text-outline" size={24} color={color} />;
          return <Feather name="user" size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" options={{ tabBarLabel: 'Home' }}>
        {(props) => <HomeFeedScreen {...props} onLogoutTrigger={onLogoutTrigger} />}
      </Tab.Screen>

      <Tab.Screen 
        name="AirDrop" 
        options={{ 
          tabBarLabel: 'AirDrop',
          tabBarBadge: unreadDrops > 0 ? unreadDrops : undefined,
          tabBarBadgeStyle: { backgroundColor: '#FF3B30', color: '#FFF', fontWeight: '900', fontSize: 10 },
        }}
      >
        {(props) => <DropsScreen {...props} onUnreadCountChange={setUnreadDrops} />}
      </Tab.Screen>

      <Tab.Screen name="Create" component={CreateDirectiveScreen} options={{ tabBarLabel: 'Create' }} />

      <Tab.Screen
        name="Gossips"
        component={GossipsInboxScreen}
        options={{
          tabBarLabel: 'Chats',
          tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
          // 🟢 Exact WhatsApp Green Badge
          tabBarBadgeStyle: { backgroundColor: '#25D366', color: '#FFF', fontWeight: 'bold', fontSize: 11 }, 
        }}
      />

      <Tab.Screen
        name="Profile"
        options={{
          tabBarLabel: 'Profile',
          tabBarBadge: hasUnreadProfileNotifications ? '' : undefined,
          tabBarBadgeStyle: { backgroundColor: '#FF3B30', minWidth: 10, minHeight: 10, maxHeight: 10, borderRadius: 5 },
        }}
      >
        {(props) => <ProfileScreen {...props} onLogoutTrigger={onLogoutTrigger} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}