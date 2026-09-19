import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Modal, Image, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'; 
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, BASE_URL, API_ROUTES } from '../services/api';
import PostCard from '../components/PostCard';

const SkeletonPost = () => (
  <View style={styles.skeletonCard}>
    <View style={styles.skeletonHeader}>
      <View style={styles.skeletonAvatar} />
      <View style={styles.skeletonTitle} />
    </View>
    <View style={styles.skeletonImageBox} />
    <View style={styles.skeletonFooter} />
  </View>
);

export default function HomeFeedScreen({ navigation }: any) {
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchType, setSearchType] = useState<'POSTS' | 'USERS'>('POSTS');
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // 🟢 Pagination & Refresh States
  const [page, setPage] = useState(0);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false); // 🟢 For Pull-to-Refresh
  const [hasMore, setHasMore] = useState(true);

  // 🟢 Viewability Tracker for Videos
  const [visiblePosts, setVisiblePosts] = useState<string[]>([]);

  const [metaMatrix, setMetaMatrix] = useState<any[]>([]);
  const [selectedCity, setSelectedCity] = useState('Global');
  const [fetchingMeta, setFetchingMeta] = useState(true);
  
  const [isCityModalVisible, setCityModalVisible] = useState(false);
  const [citySearchQuery, setCitySearchQuery] = useState('');
  const [activeUser, setActiveUser] = useState<string>('');

  // 🟢 Viewability Config (A post is "visible" if 50% of it is on screen)
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    setVisiblePosts(viewableItems.map((v: any) => String(v.item.id)));
  }).current;

  useEffect(() => {
    AsyncStorage.getItem('@active_username').then(user => {
      if (user) setActiveUser(user);
    });
  }, []);

  useEffect(() => {
    const fetchCities = async () => {
      try {
        const data = await apiClient.get(API_ROUTES.SOCIAL.CITIES);
        setMetaMatrix(data || []);
        if (data && data.length > 0 && data[0].cities.length > 0) setSelectedCity(data[0].cities[0]);
      } catch (e) {} 
      finally { setFetchingMeta(false); }
    };
    fetchCities();
  }, []);

  const executeQueryDiscovery = async (targetQuery: string, targetCity: string, pageNum: number = 0, append = false) => {
    if (!append && !isRefreshing) setIsLoading(true);
    try {
      if (!targetQuery.trim()) {
        const res = await apiClient.post(API_ROUTES.SEARCH.FEED(targetCity, pageNum, 20));
        const data = Array.isArray(res) ? res : res.content || [];
        setSearchType('POSTS');
        
        if (data.length < 20) setHasMore(false);
        setSearchResults(append ? [...searchResults, ...data] : data);
      } else {
        const res = await apiClient.get(API_ROUTES.SEARCH.DISCOVER(targetQuery.trim()));
        setSearchType(res.type || 'POSTS');
        setSearchResults(res.results || res || []);
        setHasMore(false); 
      }
    } catch (err) { 
      if (!append) setSearchResults([]); 
    } finally { 
      setIsLoading(false); 
      setIsFetchingMore(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    setPage(0);
    setHasMore(true);
    const delayDebounce = setTimeout(() => executeQueryDiscovery(searchQuery, selectedCity, 0, false), 400);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery, selectedCity]);

  // 🟢 Handle Pull-to-Refresh
  const handleRefresh = () => {
    setIsRefreshing(true);
    setPage(0);
    setHasMore(true);
    executeQueryDiscovery(searchQuery, selectedCity, 0, false);
  };

  const handleLoadMore = () => {
    if (!hasMore || isFetchingMore || isLoading || searchQuery.trim()) return;
    setIsFetchingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);
    executeQueryDiscovery(searchQuery, selectedCity, nextPage, true);
  };

  // 🟢 Navigate to Public Profile instead of Chat
  const handleUserTap = (username: string) => {
    navigation.navigate('PublicProfile', { targetUser: username });
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

      <Modal visible={isCityModalVisible} animationType="slide" transparent={true} onRequestClose={() => setCityModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setCityModalVisible(false)} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
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

      {isLoading && !isRefreshing ? (
        <ScrollView style={{ flex: 1, paddingVertical: 16 }}>
          <SkeletonPost />
          <SkeletonPost />
          <SkeletonPost />
        </ScrollView>
      ) : (
        <FlatList
          data={searchResults}
          keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
          contentContainerStyle={{ paddingBottom: 20 }}
          // 🟢 Pull to Refresh
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#FFFFFF" />}
          // 🟢 Infinite Scroll
          onEndReached={handleLoadMore} 
          onEndReachedThreshold={0.5} 
          // 🟢 Video Viewability Tracking
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          ListFooterComponent={isFetchingMore ? <ActivityIndicator size="small" color="#666" style={{ margin: 20 }} /> : null}
          renderItem={({ item }) => {
            if (searchType === 'USERS') {
              const avatarUri = item.avatarUrl || item.profilePictureUrl;
              const formattedAvatar = avatarUri ? (avatarUri.startsWith('http') ? avatarUri : `${BASE_URL}${avatarUri}`) : null;

              return (
                <TouchableOpacity style={styles.userCard} onPress={() => handleUserTap(item.username)}>
                  <View style={styles.avatarPlaceholder}>
                    {formattedAvatar ? (
                      <Image source={{ uri: formattedAvatar }} style={{ width: '100%', height: '100%', borderRadius: 20 }} />
                    ) : (
                      <Text style={{ color: '#FFFFFF', fontWeight: '900' }}>{item.username ? item.username[0].toUpperCase() : 'U'}</Text>
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
                isVisible={visiblePosts.includes(String(item.id))} // 🟢 Pass visibility down
                onUserTap={() => handleUserTap(item.username)} // 🟢 Handle avatar tap
              />
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No posts in {selectedCity} yet.</Text>
              <TouchableOpacity style={styles.emptyStateBtn} onPress={() => navigation.navigate('Create')}>
                <Text style={styles.emptyStateBtnText}>Be the first to post</Text>
              </TouchableOpacity>
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
  emptyStateText: { marginTop: 16, color: '#666666', fontSize: 14, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  emptyStateBtn: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#262626', borderRadius: 20, borderWidth: 1, borderColor: '#404040' },
  emptyStateBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  skeletonCard: { backgroundColor: '#1A1A1A', borderRadius: 8, borderWidth: 1, borderColor: '#262626', marginHorizontal: 16, marginBottom: 16, padding: 16 },
  skeletonHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  skeletonAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#262626' },
  skeletonTitle: { width: 120, height: 14, backgroundColor: '#262626', borderRadius: 4, marginLeft: 12 },
  skeletonImageBox: { width: '100%', aspectRatio: 1, backgroundColor: '#0A0A0A', borderRadius: 8, marginBottom: 16 },
  skeletonFooter: { width: '60%', height: 14, backgroundColor: '#262626', borderRadius: 4 },
});