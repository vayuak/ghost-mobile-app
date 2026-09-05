import React, { useState, useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context'; 

import HomeFeedScreen from '../screens/HomeFeedScreen';
import CreateDirectiveScreen from '../screens/CreateDirectiveScreen';
import ProfileScreen from '../screens/ProfileScreen';
import GossipsInboxScreen from '../screens/GossipsInboxScreen';
import { DropsScreen } from '../screens/DropScreen';

const Tab = createBottomTabNavigator();

export default function TabNavigator({ onLogoutTrigger }: { onLogoutTrigger: () => void }) {
  const [unreadChats, setUnreadChats] = useState(0);
  const [airDropCount, setAirDropCount] = useState(0);
  const [hasUnreadProfileNotifications, setHasUnreadProfileNotifications] = useState(false);
  
  const insets = useSafeAreaInsets(); 

  useEffect(() => {
    const checkSilentUpdates = setInterval(() => {
      // Periodic background checks for social notifications can go here
    }, 15000);

    return () => clearInterval(checkSilentUpdates);
  }, []);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { 
          backgroundColor: '#000000', 
          borderTopColor: '#262626', 
          borderTopWidth: 1, 
          height: 60 + insets.bottom, 
          paddingBottom: Math.max(10, insets.bottom), 
          paddingTop: 8 
        },
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#404040',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 4 },
        tabBarIcon: ({ color }) => {
          if (route.name === 'Home') return <Feather name="home" size={20} color={color} />;
          if (route.name === 'AirDrop') return <Feather name="radio" size={20} color={color} />;
          if (route.name === 'Create') return <Feather name="plus-square" size={20} color={color} />;
          if (route.name === 'Gossips') return <MaterialCommunityIcons name="message-text-outline" size={20} color={color} />; 
          return <Feather name="user" size={20} color={color} />;
        }
      })}
    >
      <Tab.Screen name="Home" options={{ tabBarLabel: 'Home' }}>
        {(props) => <HomeFeedScreen {...props} onLogoutTrigger={onLogoutTrigger} />}
      </Tab.Screen>

      {/* AIRDROP RADAR TAB WITH DYNAMIC BADGE */}
      <Tab.Screen 
        name="AirDrop" 
        options={{ 
          tabBarLabel: 'AirDrop',
          tabBarBadge: airDropCount > 0 ? airDropCount : undefined,
          tabBarBadgeStyle: { 
            backgroundColor: '#262626',
            color: '#FFFFFF', 
            fontWeight: '900',
            borderWidth: 1,
            borderColor: '#404040'
          }
        }} 
      >
        {() => <DropsScreen onUnreadCountChange={(count) => setAirDropCount(count)} />}
      </Tab.Screen>
      
      <Tab.Screen name="Create" component={CreateDirectiveScreen} options={{ tabBarLabel: 'Create Post' }} />
      
      <Tab.Screen 
        name="Gossips" 
        component={GossipsInboxScreen}
        options={{ 
          tabBarLabel: 'Gossips',
          tabBarBadge: unreadChats > 0 ? unreadChats : undefined,
          tabBarBadgeStyle: { 
            backgroundColor: '#262626',
            color: '#FFFFFF', 
            fontWeight: '900',
            borderWidth: 1,
            borderColor: '#404040'
          }
        }} 
      />
      
      <Tab.Screen 
        name="Profile" 
        options={{ 
          tabBarLabel: 'Profile',
          tabBarBadge: hasUnreadProfileNotifications ? '' : undefined, 
          tabBarBadgeStyle: { backgroundColor: '#FF3B30', minWidth: 10, minHeight: 10, maxHeight: 10, borderRadius: 5 }
        }} 
      >
        {(props) => <ProfileScreen {...props} onLogoutTrigger={onLogoutTrigger} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}