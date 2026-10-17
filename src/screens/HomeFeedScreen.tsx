import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList, ActivityIndicator, Modal, ScrollView, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context'; 
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { apiClient, API_ROUTES } from '../services/api';
import PostCard from '../components/PostCard';
import { ensureKeysPublished } from '../services/CryptoVault';
import { useTheme } from '../context/ThemeContext'; 

export default function HomeFeedScreen({ navigation, route }: any) {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);
  
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchType, setSearchType] = useState<'POSTS' | 'USERS'>('POSTS');
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isSearchModalVisible, setSearchModalVisible] = useState(false);
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  
  const [page, setPage] = useState(0);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const [visiblePosts, setVisiblePosts] = useState<string[]>([]);
  const [searchVisiblePosts, setSearchVisiblePosts] = useState<string[]>([]);

  const [metaMatrix, setMetaMatrix] = useState<any[]>([]);
  const [selectedCity, setSelectedCity] = useState('Global');
  const [fetchingMeta, setFetchingMeta] = useState(true);
  
  const [citySearchQuery, setCitySearchQuery] = useState(''); 
  const [activeUser, setActiveUser] = useState<string>('');
  const searchInputRef = useRef<TextInput>(null);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => { setVisiblePosts(viewableItems.map((v: any) => String(v.item.id))); }).current;
  const onSearchViewableItemsChanged = useRef(({ viewableItems }: any) => { setSearchVisiblePosts(viewableItems.map((v: any) => String(v.item.id))); }).current;

  useEffect(() => {
    ensureKeysPublished().catch(() => {});
    AsyncStorage.getItem('@active_username').then(user => { if (user) setActiveUser(user); });
  }, []);

  useFocusEffect(useCallback(() => {
    if (route.params?.autoSearch) {
      setSearchQuery(route.params.autoSearch); setSearchModalVisible(true);
      setTimeout(() => searchInputRef.current?.focus(), 200);
      navigation.setParams({ autoSearch: undefined });
    }
  }, [route.params?.autoSearch]));

  useEffect(() => {
    const fetchCities = async () => {
      try {
        const data = await apiClient.get(API_ROUTES.SOCIAL.CITIES);
        setMetaMatrix(data || []);
        if (data && data.length > 0 && data[0].cities.length > 0) setSelectedCity(data[0].cities[0]);
      } catch (e) {} finally { setFetchingMeta(false); }
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
    } catch (err) { if (!append) setSearchResults([]); setHasMore(false); } 
    finally { setIsLoading(false); setIsFetchingMore(false); setIsRefreshing(false); }
  };

  useEffect(() => {
    setPage(0); setHasMore(true);
    const delayDebounce = setTimeout(() => executeQueryDiscovery(searchQuery, selectedCity, 0, false), 400);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery, selectedCity]);

  const handleRefresh = () => { setIsRefreshing(true); setPage(0); setHasMore(true); executeQueryDiscovery(searchQuery, selectedCity, 0, false); };
  const handleLoadMore = () => { if (!hasMore || isFetchingMore || isLoading || searchQuery.trim()) return; setIsFetchingMore(true); const nextPage = page + 1; setPage(nextPage); executeQueryDiscovery(searchQuery, selectedCity, nextPage, true); };
  const handleUserTap = (username: string) => { setSearchModalVisible(false); setSearchQuery(''); navigation.navigate('PublicProfile', { targetUser: username }); };

  const allCities = metaMatrix.flatMap(continent => continent.cities);
  const filteredCities = allCities.filter(city => city.toLowerCase().includes(citySearchQuery.toLowerCase()));

  const SkeletonPost = () => (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonHeader}><View style={styles.skeletonAvatar} /><View style={styles.skeletonTitle} /></View>
      <View style={styles.skeletonImageBox} /><View style={styles.skeletonFooter} />
    </View>
  );

  return (
    <SafeAreaView style={styles.screenContainer} edges={['top']}>
      <View style={styles.headerContainer}>
        <TouchableOpacity style={styles.brandDropdown} onPress={() => setIsDropdownVisible(true)} activeOpacity={0.7}>
          <Text style={styles.brandTitle}>ViaCustos</Text>
          <Feather name="chevron-down" size={18} color={colors.text} style={styles.chevronIcon} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setSearchModalVisible(true)} style={styles.lensButton} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}><Feather name="search" size={24} color={colors.text} /></TouchableOpacity>
      </View>

      <Modal visible={isDropdownVisible} transparent={true} animationType="fade" onRequestClose={() => setIsDropdownVisible(false)}>
        <TouchableOpacity style={styles.dropdownOverlay} activeOpacity={1} onPress={() => setIsDropdownVisible(false)}>
          <View style={styles.dropdownMenu}>
            <View style={styles.dropdownSearchContainer}>
              <Feather name="search" size={14} color={colors.textMuted} style={{ marginRight: 8 }} />
              <TextInput style={styles.dropdownSearchInput} placeholder="Search city..." placeholderTextColor={colors.textMuted} value={citySearchQuery} onChangeText={setCitySearchQuery} autoCorrect={false} />
              {citySearchQuery.length > 0 && <TouchableOpacity onPress={() => setCitySearchQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Feather name="x" size={14} color={colors.textMuted} /></TouchableOpacity>}
            </View>
            {fetchingMeta ? <ActivityIndicator size="small" color={colors.text} style={{ padding: 20 }} /> : (
              <FlatList data={filteredCities} keyExtractor={(item) => item} keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.dropdownItem} onPress={() => { setSelectedCity(item); setIsDropdownVisible(false); setCitySearchQuery(''); }}>
                    <Text style={[styles.dropdownItemText, selectedCity === item && styles.dropdownItemActive]}>{item}</Text>
                    {selectedCity === item && <Feather name="check" size={16} color={colors.text} />}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center', padding: 20, fontSize: 13 }}>No matching cities</Text>}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={isSearchModalVisible} animationType="slide" transparent={false} onRequestClose={() => { setSearchModalVisible(false); setSearchQuery(''); }}>
        <SafeAreaView style={styles.modalContainer} edges={['top']}>
          <View style={styles.searchModalHeader}>
            <View style={styles.searchBarContainer}>
              <Feather name="search" size={18} color={colors.textMuted} style={{ marginRight: 8 }} />
              <TextInput ref={searchInputRef} style={styles.searchInput} placeholder="Search @username or keyword..." placeholderTextColor={colors.textMuted} value={searchQuery} onChangeText={setSearchQuery} autoCapitalize="none" autoFocus />
              {searchQuery.length > 0 && <TouchableOpacity onPress={() => setSearchQuery('')}><Feather name="x-circle" size={16} color={colors.textMuted} /></TouchableOpacity>}
            </View>
            <TouchableOpacity onPress={() => { setSearchModalVisible(false); setSearchQuery(''); }} style={{ marginLeft: 12 }}><Text style={styles.cancelBtnText}>Cancel</Text></TouchableOpacity>
          </View>

          <FlatList data={searchResults} keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()} contentContainerStyle={{ paddingBottom: 20 }} onViewableItemsChanged={onSearchViewableItemsChanged} viewabilityConfig={viewabilityConfig}
            renderItem={({ item }) => {
              if (searchType === 'USERS') {
                return (
                  <TouchableOpacity style={styles.userCard} onPress={() => handleUserTap(item.username)}>
                    <View style={styles.avatarPlaceholder}><Text style={{ color: colors.text, fontWeight: '900' }}>{item.username ? item.username[0].toUpperCase() : 'U'}</Text></View>
                    <Text style={styles.userText}>@{item.username}</Text>
                  </TouchableOpacity>
                );
              }
              return <PostCard post={item} currentUsername={activeUser} isVisible={searchVisiblePosts.includes(String(item.id)) && isSearchModalVisible} onUserTap={() => handleUserTap(item.username)} />;
            }}
            ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyStateText}>{searchQuery.trim() ? "No results found." : "Type to search users or posts..."}</Text></View>}
          />
        </SafeAreaView>
      </Modal>

      {isLoading && !isRefreshing ? (
        <ScrollView style={{ flex: 1, paddingVertical: 16 }}><SkeletonPost /><SkeletonPost /><SkeletonPost /></ScrollView>
      ) : (
        <FlatList data={searchResults} keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()} contentContainerStyle={{ paddingBottom: 20 }}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.text} />}
          onEndReached={handleLoadMore} onEndReachedThreshold={0.1} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
          ListFooterComponent={isFetchingMore ? <ActivityIndicator size="small" color={colors.textMuted} style={{ margin: 20 }} /> : null}
          renderItem={({ item }) => <PostCard post={item} currentUsername={activeUser} isVisible={visiblePosts.includes(String(item.id)) && !isSearchModalVisible && !isDropdownVisible} onUserTap={() => handleUserTap(item.username)} />}
          ListEmptyComponent={<View style={styles.emptyState}><Text style={styles.emptyStateText}>No posts in {selectedCity} yet.</Text></View>}
        />
      )}
    </SafeAreaView>
  );
}

const getStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: colors.background },
  headerContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.background, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  brandDropdown: { flexDirection: 'row', alignItems: 'center' },
  brandTitle: { color: colors.text, fontSize: 24, fontWeight: 'bold', fontStyle: 'italic' },
  chevronIcon: { marginLeft: 6, marginTop: 4 },
  lensButton: { justifyContent: 'center', alignItems: 'center' },
  dropdownOverlay: { flex: 1, backgroundColor: isDarkMode ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.2)' },
  dropdownMenu: { position: 'absolute', top: Platform.OS === 'ios' ? 100 : 60, left: 16, width: 240, maxHeight: 320, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 10, overflow: 'hidden' },
  dropdownSearchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, margin: 8, paddingHorizontal: 10, height: 36, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  dropdownSearchInput: { flex: 1, color: colors.text, fontSize: 13 },
  dropdownItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  dropdownItemText: { color: colors.textMuted, fontSize: 15, fontWeight: '600' },
  dropdownItemActive: { fontWeight: 'bold', color: colors.text },
  searchModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  searchBarContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 8, height: 42, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700' },
  cancelBtnText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
  modalContainer: { flex: 1, backgroundColor: colors.background },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 8, padding: 16, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: colors.border },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  userText: { color: colors.text, fontSize: 14, fontWeight: '800', marginLeft: 16, letterSpacing: 1 },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  emptyStateText: { marginTop: 16, color: colors.textMuted, fontSize: 14, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  skeletonCard: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, marginHorizontal: 16, marginBottom: 16, padding: 16 },
  skeletonHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  skeletonAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.border },
  skeletonTitle: { width: 120, height: 14, backgroundColor: colors.border, borderRadius: 4, marginLeft: 12 },
  skeletonImageBox: { width: '100%', aspectRatio: 1, backgroundColor: colors.border, borderRadius: 8, marginBottom: 16 },
  skeletonFooter: { width: '60%', height: 14, backgroundColor: colors.border, borderRadius: 4 },
});