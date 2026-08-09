import React, { useState, useEffect } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import HomeFeedScreen from '../screens/HomeFeedScreen';
import CreateDirectiveScreen from '../screens/CreateDirectiveScreen';
import ProfileScreen from '../screens/ProfileScreen';
import GossipsChatScreen from '../screens/GossipsChatScreen';
import GossipsInboxScreen from '../screens/GossipsInboxScreen';
const Tab = createBottomTabNavigator();

export default function TabNavigator({ onLogoutTrigger }: { onLogoutTrigger: () => void }) {
  const [unreadChats, setUnreadChats] = useState(0);
  
  // 🟢 Notifications state logic bound to the Profile Tab
  const [hasUnreadProfileNotifications, setHasUnreadProfileNotifications] = useState(false);

  useEffect(() => {
    // Background SSE polling / Interval polling here
    const checkSilentUpdates = setInterval(() => {
      // Logic to ping /v1/social/notifications/unread-count could go here
      // For now, testing logic: setHasUnreadProfileNotifications(true)
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
            height: 70, 
            paddingBottom: 10, 
            paddingTop: 8 
        },
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: '#404040',
        tabBarLabelStyle: { fontSize: 10, fontWeight: '900', letterSpacing: 1, marginTop: 4 },
        tabBarIcon: ({ color }) => {
          if (route.name === 'Home') return <Feather name="home" size={20} color={color} />;
          if (route.name === 'Create') return <Feather name="plus-square" size={20} color={color} />;
          if (route.name === 'Gossips') return <MaterialCommunityIcons name="message-text-outline" size={20} color={color} />; 
          return <Feather name="user" size={20} color={color} />;
        }
      })}
    >
      <Tab.Screen name="Home" options={{ tabBarLabel: 'Home' }}>
        {(props) => <HomeFeedScreen {...props} onLogoutTrigger={onLogoutTrigger} />}
      </Tab.Screen>
      
      <Tab.Screen name="Create" component={CreateDirectiveScreen} options={{ tabBarLabel: 'Create Post' }} />
      
     <Tab.Screen 
        name="Gossips" 
        component={GossipsInboxScreen} // 🟢 FIX: Render the Inbox here!
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
      
      {/* 🟢 FIX: Passed onLogoutTrigger via render callback just like HomeFeedScreen */}
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