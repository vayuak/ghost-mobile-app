import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, TextInput, View, TouchableOpacity, Alert, ActivityIndicator, Modal, FlatList, SafeAreaView, Platform, KeyboardAvoidingView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { apiClient } from '../services/api';

export default function CreateDirectiveScreen({ navigation }: any) {
  const isPublishingLock = useRef(false);
  const [postTitle, setPostTitle] = useState('');
  const [postContent, setPostContent] = useState('');
  const [mediaUri, setMediaUri] = useState('');
  
  const [metaMatrix, setMetaMatrix] = useState<any[]>([]);
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedContinent, setSelectedContinent] = useState('');
  const [fetchingMeta, setFetchingMeta] = useState(true);
  const [loading, setLoading] = useState(false);

  const [isCityModalVisible, setCityModalVisible] = useState(false);
  const [citySearchQuery, setCitySearchQuery] = useState('');

  useEffect(() => {
    const fetchCities = async () => {
      try {
        const data = await apiClient.get('/v1/social/meta/tier-one-cities');
        setMetaMatrix(data);
        if (data && data.length > 0 && data[0].cities.length > 0) {
          setSelectedCity(data[0].cities[0]);
          setSelectedContinent(data[0].continent);
        }
      } catch (e) {
        console.error("Failed to load locations:", e);
      } finally {
        setFetchingMeta(false);
      }
    };
    fetchCities();
  }, []);

  const selectMedia = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ 
      mediaTypes: ['images', 'videos'], 
      quality: 0.8 
    });
    
    if (!result.canceled) {
      const asset = result.assets[0];
      
      // 🟢 STRICT ENFORCEMENT: Block media larger than 50MB (52,428,800 bytes) immediately
      if (asset.fileSize && asset.fileSize > 52428800) {
        return Alert.alert("Upload Blocked", "Media file is too large. Maximum size is strictly 50MB.");
      }
      setMediaUri(asset.uri);
    }
  };

  const handlePublish = async () => {
    // 🟢 1. INSTANT TAP REJECTION: If already publishing, ignore the tap.
    if (isPublishingLock.current) return; 
    
    const safeTitle = postTitle.trim();
    const safeContent = postContent.trim();

    if (!safeTitle || !safeContent) return Alert.alert("Error", "Title and content are required.");
    if (safeTitle.length > 20) return Alert.alert("Validation Error", `Title is ${safeTitle.length} chars. Maximum is 20.`);
    if (safeContent.length > 100) return Alert.alert("Validation Error", `Content is ${safeContent.length} chars. Maximum is 100.`);
    if (!selectedCity) return Alert.alert("Error", "Target location must be selected.");
    if (!mediaUri) return Alert.alert("Error", "A media attachment is strictly required.");
    
    // 🟢 2. LOCK THE DOOR: Prevent any further taps synchronously
    isPublishingLock.current = true;
    setLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('title', safeTitle);
      formData.append('content', safeContent);
      formData.append('cityName', selectedCity);
      formData.append('country', selectedContinent);

      if (Platform.OS === 'web') {
        const response = await fetch(mediaUri);
        const blob = await response.blob();
        formData.append('file', blob, 'upload.jpg');
      } else {
        const filename = mediaUri.split('/').pop() || 'upload.jpg';
        const type = filename.endsWith('png') ? 'image/png' : 'image/jpeg';
        formData.append('file', { uri: mediaUri, name: filename, type } as any);
      }

      await apiClient.post('/v1/social/post/upload-and-create', formData);
      
      // 🟢 FIX: Platform-safe success alert so it doesn't fail silently on Web
      if (Platform.OS === 'web') {
        window.alert(`Post Published Successfully! 🚀\nYour post is now live in ${selectedCity.toUpperCase()}.`);
        setPostTitle(''); 
        setPostContent(''); 
        setMediaUri('');
        navigation.navigate('Profile');
      } else {
        Alert.alert(
          'Post Published Successfully! 🚀',
          `Your post is now live in ${selectedCity.toUpperCase()}.`,
          [{ 
              text: 'View Profile', 
              style: 'default', 
              onPress: () => {
                  setPostTitle(''); 
                  setPostContent(''); 
                  setMediaUri('');
                  navigation.navigate('Profile');
              }
          }]
        );
      }
      
    } catch (e: any) { 
      Alert.alert('Upload Failed', e.message); 
    } finally {
      // 🟢 3. UNLOCK THE DOOR: Only open if the process completes or fails
      isPublishingLock.current = false;
      setLoading(false); 
    }
  };

  const mappedCities = metaMatrix.flatMap(continent => 
    continent.cities.map((city: string) => ({ name: city, continent: continent.continent }))
  );
  const filteredCities = mappedCities.filter(cityObj => cityObj.name.toLowerCase().includes(citySearchQuery.toLowerCase()));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <View style={styles.container}>
        <Text style={styles.title}>CREATE POST</Text>
        
        {/* 🟢 STRICT ENFORCEMENT: Added visual counter for 20 max length */}
        <View style={styles.inputWrapper}>
          <TextInput 
            style={styles.input} 
            placeholder="Post Title (Max 20 chars)..." 
            placeholderTextColor="#666666" 
            value={postTitle} 
            onChangeText={setPostTitle} 
            maxLength={20} 
          />
          <Text style={[styles.charCounter, postTitle.length >= 20 ? styles.charCounterLimit : null]}>
            {postTitle.length}/20
          </Text>
        </View>

        {/* 🟢 STRICT ENFORCEMENT: Added visual counter for 100 max length */}
        <View style={styles.inputWrapper}>
          <TextInput 
            style={[styles.input, { height: 120, paddingTop: 16, paddingBottom: 30 }]} 
            placeholder="What's on your mind? (Max 100 chars)..." 
            placeholderTextColor="#666666" 
            value={postContent} 
            onChangeText={setPostContent} 
            multiline 
            maxLength={100} 
          />
          <Text style={[styles.charCounter, { bottom: 24 }, postContent.length >= 100 ? styles.charCounterLimit : null]}>
            {postContent.length}/100
          </Text>
        </View>

        <Text style={styles.label}>TARGET LOCATION</Text>
        {fetchingMeta ? (
          <ActivityIndicator size="small" color="#666666" style={{ marginBottom: 16 }} />
        ) : (
          <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setCityModalVisible(true)}>
            <Text style={styles.dropdownTriggerIcon}>📍</Text>
            <Text style={styles.dropdownTriggerText}>{selectedCity ? selectedCity.toUpperCase() : "SELECT AREA / CITY"}</Text>
            <Text style={styles.dropdownTriggerArrow}>▼</Text>
          </TouchableOpacity>
        )}

        <Modal visible={isCityModalVisible} animationType="slide" transparent={true}>
          <SafeAreaView style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setCityModalVisible(false)}>
                <Text style={styles.closeBtn}>✕ Close</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Where did this happen?</Text>
              <View style={{ width: 50 }} />
            </View>
            
            <View style={styles.modalSearchContainer}>
              <Text style={{color: '#666666', fontWeight: '900', marginRight: 10, fontSize: 16}}>🔍</Text>
              <TextInput 
                style={{flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 1}}
                placeholder="Search city..."
                placeholderTextColor="#666666"
                value={citySearchQuery}
                onChangeText={setCitySearchQuery}
              />
            </View>

            <FlatList 
              data={filteredCities}
              keyExtractor={(item, index) => item.name + index}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.cityListItem} 
                  onPress={() => {
                    setSelectedCity(item.name);
                    setSelectedContinent(item.continent);
                    setCityModalVisible(false);
                    setCitySearchQuery('');
                  }}
                >
                  <Text style={styles.cityListItemText}>{item.name.toUpperCase()}</Text>
                  <Text style={styles.cityListSubText}>{item.continent}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={{color: '#666666', textAlign: 'center', marginTop: 20}}>No cities found</Text>}
            />
          </SafeAreaView>
        </Modal>

        <TouchableOpacity style={[styles.mediaBtn, mediaUri ? styles.mediaBtnActive : null]} onPress={selectMedia}>
          <Feather name={mediaUri ? "check-circle" : "image"} size={20} color={mediaUri ? "#34C759" : "#666666"} style={{marginRight: 8}} />
          <Text style={[styles.mediaBtnText, mediaUri ? {color: '#34C759'} : null]}>
            {mediaUri ? 'MEDIA ATTACHED' : 'ATTACH MEDIA (MAX 50MB)'}
          </Text>
        </TouchableOpacity>

        {/* 🟢 STRICT ENFORCEMENT: Disable publish button entirely if rules are not met */}
        <TouchableOpacity 
          style={[styles.publishBtn, (!postTitle.trim() || !postContent.trim() || !mediaUri) ? { opacity: 0.5 } : null]} 
          onPress={handlePublish}
          disabled={!postTitle.trim() || !postContent.trim() || !mediaUri || loading}
        >
          {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.publishBtnText}>PUBLISH POST</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 60, backgroundColor: '#000000' },
  title: { fontSize: 18, fontWeight: '900', color: '#666666', marginBottom: 24, letterSpacing: 2 },
  label: { fontSize: 12, fontWeight: '800', color: '#666666', marginBottom: 12, letterSpacing: 1 },
  
  // 🟢 New styles to support character counters
  inputWrapper: { position: 'relative', marginBottom: 16 },
  input: { backgroundColor: '#1A1A1A', color: '#FFFFFF', padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#262626', fontSize: 15, fontWeight: '600' },
  charCounter: { position: 'absolute', bottom: 12, right: 12, fontSize: 10, fontWeight: '800', color: '#666666', letterSpacing: 1 },
  charCounterLimit: { color: '#FF4444' }, // Turns red when limit is hit

  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 8, padding: 16, borderWidth: 1, borderColor: '#262626', marginBottom: 24 },
  dropdownTriggerIcon: { fontSize: 18, marginRight: 10 },
  dropdownTriggerText: { flex: 1, color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  dropdownTriggerArrow: { color: '#666666', fontSize: 12, fontWeight: '900' },
  
  modalContainer: { flex: 1, backgroundColor: '#000000' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#262626' },
  closeBtn: { color: '#666666', fontWeight: '800' },
  modalTitle: { color: '#FFFFFF', fontWeight: '900', fontSize: 16, letterSpacing: 1 },
  modalSearchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 8, margin: 16, paddingHorizontal: 16, height: 48, borderWidth: 1, borderColor: '#262626' },
  cityListItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  cityListItemText: { color: '#FFFFFF', fontWeight: '700', letterSpacing: 1 },
  cityListSubText: { color: '#666666', fontSize: 10, marginTop: 4, fontWeight: '600', letterSpacing: 1 },

  mediaBtn: { flexDirection: 'row', padding: 16, borderRadius: 8, borderWidth: 1, borderColor: '#262626', backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  mediaBtnActive: { borderColor: '#34C759', backgroundColor: 'rgba(52, 199, 89, 0.05)' },
  mediaBtnText: { fontWeight: '800', color: '#666666', letterSpacing: 1 },
  publishBtn: { backgroundColor: '#262626', padding: 18, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#404040' },
  publishBtnText: { color: '#FFFFFF', fontWeight: '900', letterSpacing: 2 }
});