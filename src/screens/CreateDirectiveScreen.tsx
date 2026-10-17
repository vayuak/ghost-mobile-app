import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, TextInput, View, TouchableOpacity, Alert, ActivityIndicator, Modal, FlatList, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { apiClient, uploadMultipart, buildFilePart, API_ROUTES } from '../services/api'; 
import { compressMedia } from '../services/MediaCompressor';
import { useTheme } from '../context/ThemeContext'; 

export default function CreateDirectiveScreen({ navigation }: any) {
  const { colors, isDarkMode } = useTheme();
  const styles = getStyles(colors, isDarkMode);

  const isPublishingLock = useRef(false);
  const [postTitle, setPostTitle] = useState('');
  const [postContent, setPostContent] = useState('');
  const [mediaUri, setMediaUri] = useState('');
  const [mediaAsset, setMediaAsset] = useState<any>(null);

  const [metaMatrix, setMetaMatrix] = useState<any[]>([]);
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedContinent, setSelectedContinent] = useState('');
  const [fetchingMeta, setFetchingMeta] = useState(true);
  const [loading, setLoading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);

  const [isCityModalVisible, setCityModalVisible] = useState(false);
  const [citySearchQuery, setCitySearchQuery] = useState('');

  useEffect(() => {
    const fetchCities = async () => {
      try {
        const data = await apiClient.get(API_ROUTES.SOCIAL.CITIES);
        setMetaMatrix(data);
        if (data && data.length > 0 && data[0].cities.length > 0) { setSelectedCity(data[0].cities[0]); setSelectedContinent(data[0].continent); }
      } catch (e) { console.error("Failed to load locations:", e); } 
      finally { setFetchingMeta(false); }
    };
    fetchCities();
  }, []);

  const selectMedia = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8 });
    if (!result.canceled) {
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 52428800) return Alert.alert("Upload Blocked", "Media file is too large. Maximum size is strictly 50MB.");
      setMediaUri(asset.uri); setMediaAsset(asset);
    }
  };

  const resetForm = () => { setPostTitle(''); setPostContent(''); setMediaUri(''); setMediaAsset(null); };

  const handlePublish = async () => {
    if (isPublishingLock.current) return;
    const safeTitle = postTitle.trim(); const safeContent = postContent.trim();
    if (!safeTitle || !safeContent) return Alert.alert("Error", "Title and content are required.");
    if (!selectedCity) return Alert.alert("Error", "Target location must be selected.");
    if (!mediaUri) return Alert.alert("Error", "A media attachment is strictly required.");

    isPublishingLock.current = true; setLoading(true); setUploadPercent(0);

    try {
      const formData = new FormData();
      formData.append('title', safeTitle); formData.append('content', safeContent); formData.append('cityName', selectedCity); formData.append('country', selectedContinent);

      const isVideo = mediaAsset?.type === 'video' || mediaUri.endsWith('.mp4') || mediaUri.endsWith('.mov');
      const mediaTypeStr = isVideo ? 'video' : 'image';
      const finalUri = await compressMedia(mediaUri, mediaTypeStr);
      const filePart = buildFilePart({ ...mediaAsset, uri: finalUri });

      if (Platform.OS === 'web') { const response = await fetch(mediaUri); const blob = await response.blob(); formData.append('file', blob, filePart.name); } 
      else { formData.append('file', filePart); }

      await uploadMultipart(API_ROUTES.SOCIAL.CREATE_POST, formData, setUploadPercent);
      Toast.show({ type: 'success', text1: 'Published Successfully! 🚀', text2: `Your post is live in ${selectedCity.toUpperCase()}` });
      resetForm(); navigation.navigate('Profile');
    } catch (e: any) { Alert.alert('Upload Failed', e.message || 'Error publishing post.'); } 
    finally { isPublishingLock.current = false; setLoading(false); setUploadPercent(null); }
  };

  const mappedCities = metaMatrix.flatMap(continent => continent.cities.map((city: string) => ({ name: city, continent: continent.continent })));
  const filteredCities = mappedCities.filter(cityObj => cityObj.name.toLowerCase().includes(citySearchQuery.toLowerCase()));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.container}>
          <Text style={styles.title}>CREATE POST</Text>
          <View style={styles.inputWrapper}>
            <TextInput style={styles.input} placeholder="Post Title (Max 20 chars)..." placeholderTextColor={colors.textMuted} value={postTitle} onChangeText={setPostTitle} maxLength={20} />
            <Text style={[styles.charCounter, postTitle.length >= 20 ? styles.charCounterLimit : null]}>{postTitle.length}/20</Text>
          </View>
          <View style={styles.inputWrapper}>
            <TextInput style={[styles.input, { height: 120, paddingTop: 16, paddingBottom: 30 }]} placeholder="What's on your mind? (Max 100 chars)..." placeholderTextColor={colors.textMuted} value={postContent} onChangeText={setPostContent} multiline maxLength={100} />
            <Text style={[styles.charCounter, { bottom: 24 }, postContent.length >= 100 ? styles.charCounterLimit : null]}>{postContent.length}/100</Text>
          </View>

          <Text style={styles.label}>TARGET LOCATION</Text>
          {fetchingMeta ? <ActivityIndicator size="small" color={colors.textMuted} style={{ marginBottom: 16 }} /> : (
            <TouchableOpacity style={styles.dropdownTrigger} onPress={() => setCityModalVisible(true)}>
              <Text style={styles.dropdownTriggerIcon}>📍</Text>
              <Text style={styles.dropdownTriggerText}>{selectedCity ? selectedCity.toUpperCase() : "SELECT AREA / CITY"}</Text>
              <Text style={styles.dropdownTriggerArrow}>▼</Text>
            </TouchableOpacity>
          )}

          <Modal visible={isCityModalVisible} animationType="slide" transparent={true} onRequestClose={() => setCityModalVisible(false)}>
            <SafeAreaView style={styles.modalContainer} edges={['top', 'bottom']}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setCityModalVisible(false)} style={{ padding: 8 }}><Text style={styles.closeBtn}>✕ Close</Text></TouchableOpacity>
                <Text style={styles.modalTitle}>Where did this happen?</Text>
                <View style={{ width: 50 }} />
              </View>

              <View style={styles.modalSearchContainer}>
                <Text style={{ color: colors.textMuted, fontWeight: '900', marginRight: 10, fontSize: 16 }}>🔍</Text>
                <TextInput style={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', letterSpacing: 1 }} placeholder="Search city..." placeholderTextColor={colors.textMuted} value={citySearchQuery} onChangeText={setCitySearchQuery} />
              </View>

              <FlatList
                data={filteredCities} keyExtractor={(item, index) => item.name + index}
                renderItem={({ item }) => (
                  <TouchableOpacity style={styles.cityListItem} onPress={() => { setSelectedCity(item.name); setSelectedContinent(item.continent); setCityModalVisible(false); setCitySearchQuery(''); }}>
                    <Text style={styles.cityListItemText}>{item.name.toUpperCase()}</Text>
                    <Text style={styles.cityListSubText}>{item.continent}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 20 }}>No cities found</Text>}
              />
            </SafeAreaView>
          </Modal>

          <TouchableOpacity style={[styles.mediaBtn, mediaUri ? styles.mediaBtnActive : null]} onPress={selectMedia}>
            <Feather name={mediaUri ? "check-circle" : "image"} size={20} color={mediaUri ? "#34C759" : colors.textMuted} style={{ marginRight: 8 }} />
            <Text style={[styles.mediaBtnText, mediaUri ? { color: '#34C759' } : null]}>{mediaUri ? 'MEDIA ATTACHED' : 'ATTACH MEDIA (MAX 50MB)'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.publishBtn, (!postTitle.trim() || !postContent.trim() || !mediaUri) ? { opacity: 0.5 } : null]} onPress={handlePublish} disabled={!postTitle.trim() || !postContent.trim() || !mediaUri || loading}>
            {loading ? <Text style={styles.publishBtnText}>{uploadPercent !== null ? `UPLOADING ${uploadPercent}%` : 'PUBLISHING...'}</Text> : <Text style={styles.publishBtnText}>PUBLISH POST</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const getStyles = (colors: any, isDarkMode: boolean) => StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24, paddingVertical: 16, backgroundColor: colors.background },
  title: { fontSize: 18, fontWeight: '900', color: colors.textMuted, marginBottom: 24, letterSpacing: 2 },
  label: { fontSize: 12, fontWeight: '800', color: colors.textMuted, marginBottom: 12, letterSpacing: 1 },
  inputWrapper: { position: 'relative', marginBottom: 16 },
  input: { backgroundColor: colors.surface, color: colors.text, padding: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border, fontSize: 15, fontWeight: '600' },
  charCounter: { position: 'absolute', bottom: 12, right: 12, fontSize: 10, fontWeight: '800', color: colors.textMuted, letterSpacing: 1 },
  charCounterLimit: { color: colors.danger },
  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 8, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 24 },
  dropdownTriggerIcon: { fontSize: 18, marginRight: 10 },
  dropdownTriggerText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  dropdownTriggerArrow: { color: colors.textMuted, fontSize: 12, fontWeight: '900' },
  modalContainer: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  closeBtn: { color: colors.textMuted, fontWeight: '800', padding: 10 },
  modalTitle: { color: colors.text, fontWeight: '900', fontSize: 16, letterSpacing: 1 },
  modalSearchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 8, margin: 16, paddingHorizontal: 16, height: 48, borderWidth: 1, borderColor: colors.border },
  cityListItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  cityListItemText: { color: colors.text, fontWeight: '700', letterSpacing: 1 },
  cityListSubText: { color: colors.textMuted, fontSize: 10, marginTop: 4, fontWeight: '600', letterSpacing: 1 },
  mediaBtn: { flexDirection: 'row', padding: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  mediaBtnActive: { borderColor: '#34C759', backgroundColor: 'rgba(52, 199, 89, 0.05)' },
  mediaBtnText: { fontWeight: '800', color: colors.textMuted, letterSpacing: 1 },
  publishBtn: { backgroundColor: colors.text, padding: 18, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  publishBtnText: { color: colors.background, fontWeight: '900', letterSpacing: 2 }
});