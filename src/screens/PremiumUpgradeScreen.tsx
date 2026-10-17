import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { apiClient, API_ROUTES } from '../services/api';

export default function PremiumUpgradeScreen({ navigation }: any) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUpgrade = async () => {
    setIsProcessing(true);
    try {
      // 1. Hit your Spring Boot backend to generate the Stripe Session
      const response = await apiClient.post(API_ROUTES.BILLING.INITIATE_CHECKOUT);
      
      if (response.checkoutUrl) {
        // 2. Open the Stripe Checkout page in the device browser
        await Linking.openURL(response.checkoutUrl);
        // Navigate back; the webhook will handle the DB update silently
        navigation.goBack();
      } else {
        throw new Error("Invalid checkout session returned.");
      }
    } catch (e: any) {
      Alert.alert("Upgrade Failed", e.message || "Could not process premium activation.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
          <Feather name="arrow-left" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ViaCustos PREMIUM</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <View style={styles.badgeContainer}>
          <Text style={styles.badgeText}>✨ PRO</Text>
        </View>

        <Text style={styles.mainTitle}>Unlock Full Potential</Text>
        <Text style={styles.subTitle}>Upgrade your node for complete unrestricted network access.</Text>

        <View style={styles.featureBox}>
          <View style={styles.featureRow}>
            <Feather name="check-circle" size={20} color="#34C759" />
            <Text style={styles.featureText}>Unlimited Daily AirDrops (No 10/day limit)</Text>
          </View>
          <View style={styles.featureRow}>
            <Feather name="check-circle" size={20} color="#34C759" />
            <Text style={styles.featureText}>Zero Advertisements</Text>
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.upgradeBtn, isProcessing && { opacity: 0.7 }]} 
          onPress={handleUpgrade}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.upgradeBtnText}>Activate Premium — $9.99</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, borderBottomWidth: 1, borderColor: '#1A1A1A' },
  headerTitle: { color: '#FFF', fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  content: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  badgeContainer: { backgroundColor: 'rgba(251, 191, 36, 0.15)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderBottomWidth: 1, borderColor: '#FBBF24', marginBottom: 20 },
  badgeText: { color: '#FBBF24', fontWeight: '900', fontSize: 14, letterSpacing: 1 },
  mainTitle: { color: '#FFF', fontSize: 26, fontWeight: '900', textAlign: 'center', marginBottom: 8 },
  subTitle: { color: '#8E95A5', fontSize: 14, textAlign: 'center', marginBottom: 32 },
  featureBox: { width: '100%', backgroundColor: '#1A1A1A', borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#262626', marginBottom: 32 },
  featureRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  featureText: { color: '#FFF', fontSize: 14, fontWeight: '700', marginLeft: 12 },
  upgradeBtn: { width: '100%', backgroundColor: '#FBBF24', paddingVertical: 16, borderRadius: 30, alignItems: 'center' },
  upgradeBtnText: { color: '#000000', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 }
});