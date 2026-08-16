import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Modal, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'; // 🟢 FIX: Replaced react-native SafeAreaView to stop UI overlap
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, BASE_URL } from '../services/api';
import PostCard from '../components/PostCard';

export default function HomeFeedScreen({ navigation }: any) {
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchType, setSearchType] = useState<'POSTS' | 'USERS'>('POSTS');
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [metaMatrix, setMetaMatrix] = useState<any[]>([]);
  const [selectedCity, setSelectedCity] = useState('Global');
  const [fetchingMeta, setFetchingMeta] = useState(true);
  
  const [isCityModalVisible, setCityModalVisible] = useState(false);
  const [citySearchQuery, setCitySearchQuery] = useState('');
  const [activeUser, setActiveUser] = useState<string>('');

  useEffect(() => {
    AsyncStorage.getItem('@active_username').then(user => {
      if (user) setActiveUser(user);
    });
  }, []);

  useEffect(() => {
    const silentRefreshInterval = setInterval(async () => {
      if (!searchQuery.trim()) {
        try {
          const token = await AsyncStorage.getItem('@ghost_token');
          if (!token) return; 
          
          const res = await apiClient.post(`/v1/social/feed?city=${encodeURIComponent(selectedCity)}&page=0&size=20`);
          setSearchResults(Array.isArray(res) ? res : res.content || []);
        } catch (e) {
          // Ignore network blips safely
        }
      }
    }, 10000); 

    return () => clearInterval(silentRefreshInterval);
  }, [selectedCity, searchQuery]);

  useEffect(() => {
    const fetchCities = async () => {
      try {
        const data = await apiClient.get('/v1/social/meta/tier-one-cities');
        setMetaMatrix(data || []);
        if (data && data.length > 0 && data[0].cities.length > 0) setSelectedCity(data[0].cities[0]);
      } catch (e) { console.error(e); } 
      finally { setFetchingMeta(false); }
    };
    fetchCities();
  }, []);

  const executeQueryDiscovery = async (targetQuery: string, targetCity: string) => {
    setIsLoading(true);
    try {
      if (!targetQuery.trim()) {
        const res = await apiClient.post(`/v1/social/feed?city=${encodeURIComponent(targetCity)}&page=0&size=20`);
        setSearchType('POSTS');
        setSearchResults(Array.isArray(res) ? res : res.content || []);
      } else {
        const res = await apiClient.get(`/v1/social/search?keyword=${encodeURIComponent(targetQuery.trim())}`);
        setSearchType(res.type || 'POSTS');
        setSearchResults(res.results || res || []);
      }
    } catch (err) { setSearchResults([]); } 
    finally { setIsLoading(false); }
  };

  useEffect(() => {
    const delayDebounce = setTimeout(() => executeQueryDiscovery(searchQuery, selectedCity), 400);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery, selectedCity]);

  const handleUserTap = (username: string) => {
    navigation.navigate('GossipsChat', { targetUser: username });
  };

  const allCities = metaMatrix.flatMap(continent => continent.cities);
  const filteredCities = allCities.filter(city => city.toLowerCase().includes(citySearchQuery.toLowerCase()));

  return (
    <SafeAreaView style={styles.screenContainer} edges={['top']}>
      <View style={styles.headerContainer}>
        <View style={styles.searchBarContainer}>
          <Text style={styles.searchPrefix}>🔍</Text>
          <TextInput 
            style={styles.searchInput}
            placeholder="Search users or posts..."
            placeholderTextColor="#666666"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.citySelectorContainer}>
        {fetchingMeta ? (
          <ActivityIndicator size="small" color="#666666" />
        ) : (
          <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setCityModalVisible(true)}>
            <Text style={styles.dropdownTriggerIcon}>📍</Text>
            <Text style={styles.dropdownTriggerText}>{selectedCity.toUpperCase()}</Text>
            <Text style={styles.dropdownTriggerArrow}>▼</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={isCityModalVisible} animationType="slide" transparent={true}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setCityModalVisible(false)}>
              <Text style={styles.closeBtn}>✕ Close</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Select Area/City</Text>
            <View style={{ width: 50 }} />
          </View>
          
          <View style={styles.modalSearchContainer}>
            <Text style={styles.searchPrefix}>🔍</Text>
            <TextInput 
              style={styles.searchInput}
              placeholder="Search city..."
              placeholderTextColor="#666666"
              value={citySearchQuery}
              onChangeText={setCitySearchQuery}
            />
          </View>

          <FlatList 
            data={filteredCities}
            keyExtractor={(item, index) => item + index}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.cityListItem} 
                onPress={() => {
                  setSelectedCity(item);
                  setCityModalVisible(false);
                  setCitySearchQuery('');
                }}
              >
                <Text style={styles.cityListItemText}>{item.toUpperCase()}</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={styles.emptyStateText}>No cities found</Text>}
          />
        </SafeAreaView>
      </Modal>

      {isLoading ? (
        <ActivityIndicator size="large" color="#666666" style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={searchResults}
          keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item }) => {
            if (searchType === 'USERS') {
              const avatarUri = item.avatarUrl || item.profilePictureUrl;
              const formattedAvatar = avatarUri 
                ? (avatarUri.startsWith('http') ? avatarUri : `${BASE_URL}${avatarUri}`)
                : null;

              return (
                <TouchableOpacity style={styles.userCard} onPress={() => handleUserTap(item.username)}>
                  <View style={styles.avatarPlaceholder}>
                    {formattedAvatar ? (
                      <Image 
                        source={{ uri: formattedAvatar }} 
                        style={{ width: '100%', height: '100%', borderRadius: 20 }} 
                      />
                    ) : (
                      <Text style={{ color: '#FFFFFF', fontWeight: '900' }}>
                        {item.username ? item.username[0].toUpperCase() : 'U'}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.userText}>@{item.username}</Text>
                </TouchableOpacity>
              );
            }
            
            return (
              <PostCard 
                post={item} 
                currentUsername={activeUser} 
              />
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No Results Found</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: '#000000' },
  headerContainer: { backgroundColor: '#1A1A1A', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#262626' },
  searchBarContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#000000', borderRadius: 8, height: 48, paddingHorizontal: 16, borderWidth: 1, borderColor: '#262626' },
  searchPrefix: { color: '#666666', fontWeight: '900', marginRight: 10, fontSize: 16 },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  citySelectorContainer: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#262626' },
  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#262626' },
  dropdownTriggerIcon: { fontSize: 16, marginRight: 8 },
  dropdownTriggerText: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  dropdownTriggerArrow: { color: '#666666', fontSize: 12, fontWeight: '900' },
  modalContainer: { flex: 1, backgroundColor: '#000000' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#262626' },
  closeBtn: { color: '#666666', fontWeight: '800' },
  modalTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
  modalSearchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 8, margin: 16, paddingHorizontal: 16, height: 48, borderWidth: 1, borderColor: '#262626' },
  cityListItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  cityListItemText: { color: '#FFFFFF', fontWeight: '700', letterSpacing: 1 },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 8, padding: 16, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: '#262626' },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#404040', overflow: 'hidden' },
  userText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginLeft: 16, letterSpacing: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  emptyStateText: { marginTop: 16, color: '#666666', fontSize: 14, fontWeight: '800', letterSpacing: 1, textAlign: 'center' }
});