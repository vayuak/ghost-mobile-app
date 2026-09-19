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

const Tab = createBottomTabNavigator();
const BAR_CONTENT_HEIGHT = 58; 

export default function TabNavigator({ onLogoutTrigger }: { onLogoutTrigger: () => void }) {
  const [unreadChats, setUnreadChats] = useState(0);
  const [unreadDrops, setUnreadDrops] = useState(0);
  const [hasUnreadProfileNotifications] = useState(false);
  const insets = useSafeAreaInsets();

  // 🟢 Battery-friendly event listener. Triggers ONLY when SQLite saves or marks a message.
  useEffect(() => {
    const updateChatBadge = async () => {
      try {
        const me = await AsyncStorage.getItem('@active_username');
        if (me) {
          setUnreadChats(getUnreadChatsCount(me));
        }
      } catch (e) { }
    };

    updateChatBadge(); // Check on mount
    const subscription = DeviceEventEmitter.addListener('db_chats_updated', updateChatBadge);

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#000000',
          borderTopColor: '#262626',
          borderTopWidth: 1,
          height: BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 8,
          elevation: 0,
        },
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#404040',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 2 },
        tabBarIcon: ({ color }) => {
          if (route.name === 'Home') return <Feather name="home" size={20} color={color} />;
          if (route.name === 'AirDrop') return <Feather name="radio" size={20} color={color} />;
          if (route.name === 'Create') return <Feather name="plus-square" size={20} color={color} />;
          if (route.name === 'Gossips') return <MaterialCommunityIcons name="message-text-outline" size={20} color={color} />;
          return <Feather name="user" size={20} color={color} />;
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
          tabBarBadgeStyle: { backgroundColor: '#262626', color: '#FFFFFF', fontWeight: '900', borderWidth: 1, borderColor: '#404040' },
        }}
      >
        {(props) => <DropsScreen {...props} onUnreadCountChange={setUnreadDrops} />}
      </Tab.Screen>

      <Tab.Screen name="Create" component={CreateDirectiveScreen} options={{ tabBarLabel: 'Create Post' }} />

      <Tab.Screen
        name="Gossips"
        component={GossipsInboxScreen}
        options={{
          tabBarLabel: 'Gossips',
          tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
          tabBarBadgeStyle: { backgroundColor: '#262626', color: '#FFFFFF', fontWeight: '900', borderWidth: 1, borderColor: '#404040' },
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