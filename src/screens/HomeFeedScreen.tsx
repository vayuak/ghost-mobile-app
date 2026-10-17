import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Modal, Image, ScrollView, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'; 
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { apiClient, BASE_URL, API_ROUTES } from '../services/api';
import PostCard from '../components/PostCard';
import { ensureKeysPublished } from '../services/CryptoVault';

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

export default function HomeFeedScreen({ navigation, route }: any) {
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchType, setSearchType] = useState<'POSTS' | 'USERS'>('POSTS');
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isSearchModalVisible, setSearchModalVisible] = useState(false);
  const [isDropdownVisible, setIsDropdownVisible] = useState(false); // 🟢 IG-Style Dropdown State
  
  const [page, setPage] = useState(0);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [visiblePosts, setVisiblePosts] = useState<string[]>([]);
  const [metaMatrix, setMetaMatrix] = useState<any[]>([]);
  const [selectedCity, setSelectedCity] = useState('Global');
  const [fetchingMeta, setFetchingMeta] = useState(true);
  
  const [activeUser, setActiveUser] = useState<string>('');
  const searchInputRef = useRef<TextInput>(null);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    setVisiblePosts(viewableItems.map((v: any) => String(v.item.id)));
  }).current;

  useEffect(() => {
    ensureKeysPublished().catch(() => {});
    AsyncStorage.getItem('@active_username').then(user => { if (user) setActiveUser(user); });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (route.params?.autoSearch) {
        setSearchQuery(route.params.autoSearch);
        setSearchModalVisible(true);
        setTimeout(() => searchInputRef.current?.focus(), 200);
        navigation.setParams({ autoSearch: undefined });
      }
    }, [route.params?.autoSearch])
  );

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
    if (append && !hasMore) return;
    if (!append && !isRefreshing) setIsLoading(true);
    
    try {
      if (!targetQuery.trim()) {
        const res = await apiClient.get(API_ROUTES.SOCIAL.FEED(targetCity, pageNum, 20));
        const data = Array.isArray(res) ? res : res.content || [];
        setSearchType('POSTS');
        if (!data || data.length < 20) setHasMore(false);
        setSearchResults(append ? [...searchResults, ...data] : data);
      } else {
        const res = await apiClient.get(API_ROUTES.SOCIAL.DISCOVER(targetQuery.trim()));
        setSearchType(res.type || 'POSTS');
        setSearchResults(res.results || res || []);
        setHasMore(false);
      }
    } catch (err) { 
      if (!append) setSearchResults([]); 
      setHasMore(false);
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

  const handleUserTap = (username: string) => {
    setSearchModalVisible(false);
    setSearchQuery('');
    navigation.navigate('PublicProfile', { targetUser: username });
  };

  const allCities = metaMatrix.flatMap(continent => continent.cities);

  return (
    <SafeAreaView style={styles.screenContainer} edges={['top']}>
      
      {/* 🟢 CLASSIC INSTA-STYLE HEADER */}
      <View style={styles.headerContainer}>
        <TouchableOpacity 
          style={styles.brandDropdown} 
          onPress={() => setIsDropdownVisible(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.brandTitle}>ViaCustos</Text>
          <Feather name="chevron-down" size={18} color="#FFFFFF" style={styles.chevronIcon} />
        </TouchableOpacity>

        <TouchableOpacity 
          onPress={() => setSearchModalVisible(true)} 
          style={styles.lensButton}
          hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
        >
          <Feather name="search" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* 🟢 FLOATING LOCATION DROPDOWN (Matches IG screenshot) */}
      <Modal visible={isDropdownVisible} transparent={true} animationType="fade" onRequestClose={() => setIsDropdownVisible(false)}>
        <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPress={() => setIsDropdownVisible(false)}>
          <View style={styles.dropdownMenu}>
            {fetchingMeta ? (
               <ActivityIndicator size="small" color="#FFF" style={{ padding: 20 }} />
            ) : (
              <FlatList 
                data={allCities}
                keyExtractor={(item) => item}
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    style={styles.dropdownItem} 
                    onPress={() => {
                      setSelectedCity(item);
                      setIsDropdownVisible(false);
                    }}
                  >
                    <Text style={[styles.dropdownItemText, selectedCity === item && styles.dropdownItemActive]}>{item}</Text>
                    {selectedCity === item && <Feather name="check" size={16} color="#FFFFFF" />}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 🟢 SEARCH OVERLAY MODAL */}
      <Modal visible={isSearchModalVisible} animationType="slide" transparent={false} onRequestClose={() => { setSearchModalVisible(false); setSearchQuery(''); }}>
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <View style={styles.searchModalHeader}>
            <View style={styles.searchBarContainer}>
              <Feather name="search" size={18} color="#666" style={{ marginRight: 8 }} />
              <TextInput 
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Search @username or keyword..."
                placeholderTextColor="#666666"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoFocus
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Feather name="x-circle" size={16} color="#666" />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity onPress={() => { setSearchModalVisible(false); setSearchQuery(''); }} style={{ marginLeft: 12 }}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={searchResults}
            keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
            contentContainerStyle={{ paddingBottom: 20 }}
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
              return <PostCard post={item} currentUsername={activeUser} isVisible={true} onUserTap={() => handleUserTap(item.username)} />;
            }}
          />
        </SafeAreaView>
      </Modal>

      {/* 🟢 MAIN FEED CONTENT */}
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
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor="#FFFFFF" />}
          onEndReached={handleLoadMore} 
          onEndReachedThreshold={0.1}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          ListFooterComponent={isFetchingMore ? <ActivityIndicator size="small" color="#666" style={{ margin: 20 }} /> : null}
          renderItem={({ item }) => (
            <PostCard 
              post={item} 
              currentUsername={activeUser} 
              isVisible={visiblePosts.includes(String(item.id))}
              onUserTap={() => handleUserTap(item.username)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No posts in {selectedCity} yet.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: '#000000' },
  headerContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    backgroundColor: '#000000', 
    paddingHorizontal: 16, 
    paddingVertical: 12, 
    borderBottomWidth: 1, 
    borderBottomColor: '#1A1A1A' 
  },
  brandDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandTitle: { 
    color: '#FFFFFF', 
    fontSize: 24, 
    fontWeight: 'bold', 
    fontStyle: 'italic', // Gives it that classic script aesthetic
  },
  chevronIcon: {
    marginLeft: 6,
    marginTop: 4
  },
  lensButton: { 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  
  // Floating Dropdown Styles
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)', // Subtle dim
  },
  dropdownMenu: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 60, // Adjusts just below the header
    left: 16,
    width: 220,
    maxHeight: 300,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
    overflow: 'hidden'
  },
  dropdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#262626'
  },
  dropdownItemText: {
    color: '#E5E5E5',
    fontSize: 15,
    fontWeight: '600'
  },
  dropdownItemActive: {
    fontWeight: 'bold',
    color: '#FFFFFF'
  },

  // Modal and Search Styles
  searchModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#000000', borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  searchBarContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 8, height: 42, paddingHorizontal: 12, borderWidth: 1, borderColor: '#262626' },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  cancelBtnText: { color: '#FF3B30', fontWeight: '700', fontSize: 15 },
  modalContainer: { flex: 1, backgroundColor: '#000000' },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 8, padding: 16, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: '#262626' },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#262626', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#404040', overflow: 'hidden' },
  userText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginLeft: 16, letterSpacing: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  emptyStateText: { marginTop: 16, color: '#666666', fontSize: 14, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  skeletonCard: { backgroundColor: '#1A1A1A', borderRadius: 8, borderWidth: 1, borderColor: '#262626', marginHorizontal: 16, marginBottom: 16, padding: 16 },
  skeletonHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  skeletonAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#262626' },
  skeletonTitle: { width: 120, height: 14, backgroundColor: '#262626', borderRadius: 4, marginLeft: 12 },
  skeletonImageBox: { width: '100%', aspectRatio: 1, backgroundColor: '#0A0A0A', borderRadius: 8, marginBottom: 16 },
  skeletonFooter: { width: '60%', height: 14, backgroundColor: '#262626', borderRadius: 4 },
});