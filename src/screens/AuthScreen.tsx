import React, { useState, useEffect } from 'react';
import { Text, View, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, BackHandler, Linking, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiClient, API_ROUTES } from '../services/api';
import { initializeDeviceKeys } from '../services/CryptoVault';

// 🟢 FORCED LIGHT THEME (Overrides system settings for Auth)
const lightAuthColors = {
  background: '#FFFFFF',
  surface: '#F5F5F7',
  text: '#000000',
  textMuted: '#6E6E73',
  border: '#E5E5EA',
  primary: '#007AFF',
  danger: '#FF3B30',
};

export default function AuthScreen({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const styles = getStyles();
  const [currentMode, setCurrentMode] = useState<'LOGIN' | 'REGISTER' | 'FORGOT_PASSWORD'>('LOGIN');
  const [workflowStep, setWorkflowStep] = useState<1 | 2>(1); 
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [hasConsented, setHasConsented] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [contactId, setContactId] = useState(''); 
  const [otpCode, setOtpCode] = useState('');
  
  const [uiMessage, setUiMessage] = useState<{ text: string, type: 'error' | 'success' } | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<'AVAILABLE' | 'TAKEN' | null>(null);

  useEffect(() => {
    const backAction = () => {
      if (workflowStep === 2) { setWorkflowStep(1); return true; }
      if (currentMode !== 'LOGIN') { setCurrentMode('LOGIN'); setUiMessage(null); return true; }
      return false; 
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [currentMode, workflowStep]);

  useEffect(() => {
    if (currentMode !== 'REGISTER' || username.length < 3) { setUsernameStatus(null); return; }
    const checkUsername = async () => {
      try {
        const res = await apiClient.get(`${API_ROUTES.AUTH.CHECK_USERNAME}?username=${username}`);
        setUsernameStatus(res.available ? 'AVAILABLE' : 'TAKEN');
      } catch (e) { setUsernameStatus(null); }
    };
    const delayDebounceFn = setTimeout(() => checkUsername(), 500);
    return () => clearTimeout(delayDebounceFn);
  }, [username, currentMode]);

  const isValidEmail = (email: string) => /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
  const isStrongPassword = (pass: string) => pass.length >= 8 && /[A-Z]/.test(pass) && /[0-9]/.test(pass) && /[^A-Za-z0-9]/.test(pass);

  const sanitizeError = (err: any) => {
    if (err?.response?.data && typeof err.response.data === 'object' && !err.response.data.error) return err.response.data[Object.keys(err.response.data)[0]] || 'Invalid input.';
    const msg = err?.message?.toLowerCase() || err?.response?.data?.error?.toLowerCase() || '';
    if (msg.includes('suspended') || msg.includes('blocked')) return 'Your account has been suspended. Please contact support.';
    if (msg.includes('incorrect') || msg.includes('bad credentials')) return 'Incorrect email or password.';
    if (msg.includes('contact method')) return 'Email already registered. Return to login.';
    if (msg.includes('identity signature')) return 'Username is already taken.';
    return err?.response?.data?.error || err?.message || 'An unexpected error occurred.';
  };

  const validateInput = () => {
    if ((currentMode === 'REGISTER' || currentMode === 'FORGOT_PASSWORD') && !isValidEmail(contactId.trim())) {
      setUiMessage({ text: 'Please enter a valid email address.', type: 'error' }); return false;
    }
    if (currentMode === 'REGISTER') {
      if (!isStrongPassword(password)) { setUiMessage({ text: 'Password needs 8+ chars, 1 uppercase, 1 number, 1 special character.', type: 'error' }); return false; }
      if (usernameStatus === 'TAKEN') { setUiMessage({ text: 'Username is taken.', type: 'error' }); return false; }
    }
    return true;
  };

  const handleLogin = async () => {
    setUiMessage(null);
    if (!contactId || !password) return setUiMessage({ text: 'Email and password are required.', type: 'error' });
    setLoading(true);
    try {
      const res = await apiClient.post(API_ROUTES.AUTH.LOGIN, { identifier: contactId.trim(), password });
      const jwtToken = res.jwt || res.token;
      if (jwtToken) {
        await AsyncStorage.setItem('@ghost_token', jwtToken);
        try {
          const meRes = await apiClient.get(API_ROUTES.AUTH.ME);
          await AsyncStorage.setItem('@active_username', meRes.username.trim().toLowerCase());
        } catch (meError) {
          const fallback = contactId.includes('@') ? contactId.split('@')[0] : contactId;
          await AsyncStorage.setItem('@active_username', fallback.toLowerCase().trim());
        }
        onAuthSuccess(); 
      }
    } catch (err: any) { setUiMessage({ text: sanitizeError(err), type: 'error' }); } 
    finally { setLoading(false); }
  };

  const handleRegister = async () => {
    setUiMessage(null);
    if (!hasConsented) return Alert.alert("Consent Required", "You must agree to the Terms of Service.");
    if (!username || !password || !contactId) return setUiMessage({ text: 'All fields are mandatory.', type: 'error' });
    if (!validateInput()) return;
    
    setLoading(true);
    try {
      const cleanUsername = username.toLowerCase().trim();
      const realPublicKey = await initializeDeviceKeys(cleanUsername);
      await apiClient.post(API_ROUTES.AUTH.REGISTER, { username: cleanUsername, password, contactIdentifier: contactId.trim(), publicKey: realPublicKey });
      setUiMessage({ text: `Verification code sent to ${contactId.trim()}`, type: 'success' }); 
      setWorkflowStep(2); 
    } catch (err: any) { setUiMessage({ text: sanitizeError(err), type: 'error' }); } 
    finally { setLoading(false); }
  };

  const handleForgotPassword = async () => {
    setUiMessage(null);
    if (!contactId) return setUiMessage({ text: 'Email address is required.', type: 'error' });
    if (!validateInput()) return;
    setLoading(true);
    try {
      await apiClient.post(API_ROUTES.AUTH.FORGOT_PASSWORD, { identifier: contactId.trim() });
      setUiMessage({ text: `Recovery code sent to ${contactId.trim()}`, type: 'success' });
      setWorkflowStep(2);
    } catch (err: any) { setUiMessage({ text: sanitizeError(err), type: 'error' }); } 
    finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    setUiMessage(null);
    if (currentMode === 'FORGOT_PASSWORD' && !isStrongPassword(password)) return setUiMessage({ text: 'Your new password must be at least 8 characters...', type: 'error' });
    setLoading(true);
    try {
      if (currentMode === 'FORGOT_PASSWORD') {
        await apiClient.post(API_ROUTES.AUTH.RESET_PASSWORD, { identifier: contactId.trim(), newPassword: password, otp: otpCode.trim() });
        setUiMessage({ text: 'Password reset successful. Returning to login.', type: 'success' });
      } else {
        const cleanTarget = (username || contactId).toLowerCase().trim();
        await apiClient.post(API_ROUTES.AUTH.VERIFY_OTP, { username: cleanTarget, otp: otpCode.trim() });
        setUiMessage({ text: 'Verification complete. You can now login.', type: 'success' });
      }
      setTimeout(() => { setWorkflowStep(1); setCurrentMode('LOGIN'); setPassword(''); setOtpCode(''); }, 2000);
    } catch (err: any) { setUiMessage({ text: sanitizeError(err), type: 'error' }); } 
    finally { setLoading(false); }
  };

  const executePrimaryAction = () => {
    if (currentMode === 'LOGIN') handleLogin();
    else if (currentMode === 'REGISTER') handleRegister();
    else handleForgotPassword();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: lightAuthColors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          
          <Text style={styles.brandTitle}>ViaCustos</Text>
          <Text style={styles.brandSubtitle}>Explore together. Travel safely.</Text>
          
          <View style={styles.card}>
            <Text style={styles.modeText}>[{currentMode} PROTOCOL]</Text>

            {workflowStep === 1 ? (
              <>
                {currentMode === 'REGISTER' && (
                  <View style={styles.inputWrapper}>
                    <TextInput style={styles.inputPill} value={username} onChangeText={setUsername} placeholder="Username" placeholderTextColor={lightAuthColors.textMuted} autoCapitalize="none"/>
                    {usernameStatus === 'AVAILABLE' && <Text style={[styles.statusTextRight, { color: lightAuthColors.primary }]}>[ √ ]</Text>}
                    {usernameStatus === 'TAKEN' && <Text style={[styles.statusTextRight, { color: lightAuthColors.danger }]}>[ X ]</Text>}
                  </View>
                )}
                
                <View style={styles.inputWrapper}>
                  <TextInput style={styles.inputPill} value={contactId} onChangeText={setContactId} placeholder={currentMode === 'LOGIN' ? 'Email or Username' : 'Email Address'} placeholderTextColor={lightAuthColors.textMuted} autoCapitalize="none" keyboardType="email-address"/>
                </View>

                {currentMode !== 'FORGOT_PASSWORD' && (
                  <View style={styles.inputWrapper}>
                    <TextInput style={[styles.inputPill, { paddingRight: 50 }]} value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor={lightAuthColors.textMuted} secureTextEntry={!showPassword} autoCapitalize="none"/>
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                      <Feather name={showPassword ? "eye" : "eye-off"} size={20} color={lightAuthColors.textMuted} />
                    </TouchableOpacity>
                  </View>
                )}

                {uiMessage && (
                  <View style={styles.messageBox}>
                    <Text style={[styles.messageText, uiMessage.type === 'error' ? { color: lightAuthColors.danger } : { color: lightAuthColors.primary }]}>{uiMessage.text}</Text>
                  </View>
                )}

                {currentMode === 'REGISTER' ? (
                  <TouchableOpacity style={styles.consentRow} onPress={() => setHasConsented(!hasConsented)} activeOpacity={0.8}>
                    <View style={[styles.checkbox, hasConsented && styles.checkboxActive]}>{hasConsented && <Feather name="check" size={14} color="#FFF" />}</View>
                    <Text style={styles.consentText}>I agree to the <Text style={styles.linkText} onPress={() => Linking.openURL('https://viacustos.com/terms')}>Terms</Text> and <Text style={styles.linkText} onPress={() => Linking.openURL('https://viacustos.com/privacy')}>Privacy Policy</Text>.</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.disclaimerText}>By continuing, you agree to our Terms of Service and Privacy Policy.</Text>
                  </View>
                )}

                <TouchableOpacity style={[styles.primaryButton, (currentMode === 'REGISTER' && !hasConsented) && styles.primaryButtonDisabled]} onPress={executePrimaryAction} disabled={currentMode === 'REGISTER' && !hasConsented || loading} activeOpacity={0.8}>
                  {loading ? <ActivityIndicator color="#FFF"/> : <Text style={styles.primaryBtnText}>{currentMode === 'LOGIN' ? 'LOG IN' : currentMode === 'REGISTER' ? 'CREATE ACCOUNT' : 'SEND RESET CODE'}</Text>}
                </TouchableOpacity>

                <View style={styles.toggleRow}>
                  {currentMode === 'LOGIN' ? (
                    <>
                      <TouchableOpacity onPress={() => { setCurrentMode('REGISTER'); setUiMessage(null); }} hitSlop={{ top: 10, bottom: 10 }}><Text style={styles.link}>New User? Register</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => { setCurrentMode('FORGOT_PASSWORD'); setUiMessage(null); }} hitSlop={{ top: 10, bottom: 10 }}><Text style={styles.link}>Forgot Password?</Text></TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity onPress={() => { setCurrentMode('LOGIN'); setUiMessage(null); }} hitSlop={{ top: 10, bottom: 10 }}><Text style={styles.link}>Return to Login</Text></TouchableOpacity>
                  )}
                </View>
              </>
            ) : (
              <>
                {currentMode === 'FORGOT_PASSWORD' && (
                  <View style={styles.inputWrapper}>
                    <TextInput style={[styles.inputPill, { paddingRight: 50 }]} value={password} onChangeText={setPassword} placeholder="New Password" placeholderTextColor={lightAuthColors.textMuted} secureTextEntry={!showPassword} autoCapitalize="none"/>
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon} hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}>
                      <Feather name={showPassword ? "eye" : "eye-off"} size={20} color={lightAuthColors.textMuted} />
                    </TouchableOpacity>
                  </View>
                )}
                
                <Text style={styles.label}>6-Digit Verification Code</Text>
                <TextInput style={[styles.inputPill, { fontSize: 24, letterSpacing: 10, textAlign: 'center', marginTop: 8 }]} value={otpCode} onChangeText={setOtpCode} placeholder="------" placeholderTextColor={lightAuthColors.textMuted} keyboardType="number-pad" maxLength={6}/>
                
                {uiMessage && (
                  <View style={styles.messageBox}><Text style={[styles.messageText, uiMessage.type === 'error' ? { color: lightAuthColors.danger } : { color: lightAuthColors.primary }]}>{uiMessage.text}</Text></View>
                )}
                
                <TouchableOpacity style={styles.primaryButton} onPress={handleVerifyOtp} disabled={loading} activeOpacity={0.8}>
                  {loading ? <ActivityIndicator color="#FFF"/> : <Text style={styles.primaryBtnText}>VERIFY CODE</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// 🟢 FIX: 100% Flat, Borderless UI merged with your exact functional layout
const getStyles = () => StyleSheet.create({
  container: { flexGrow: 1, padding: 24, justifyContent: 'center' }, 
  brandTitle: { color: lightAuthColors.text, fontSize: 36, fontWeight: '900', letterSpacing: 2, textAlign: 'center', fontStyle: 'italic', marginBottom: 8 },
  brandSubtitle: { color: lightAuthColors.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'center', marginBottom: 40 },
  card: { padding: 8 }, 
  modeText: { color: lightAuthColors.textMuted, fontSize: 12, fontWeight: '800', textAlign: 'center', marginBottom: 24, letterSpacing: 2 },
  label: { color: lightAuthColors.textMuted, fontSize: 11, fontWeight: '800', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'center' },
  inputWrapper: { position: 'relative', justifyContent: 'center', marginBottom: 16 },
  statusTextRight: { position: 'absolute', right: 18, fontWeight: 'bold' },
  inputPill: { backgroundColor: lightAuthColors.surface, color: lightAuthColors.text, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 16, fontSize: 15, fontWeight: '600' },
  eyeIcon: { position: 'absolute', right: 18, zIndex: 10 },
  messageBox: { marginBottom: 16, padding: 12, backgroundColor: lightAuthColors.surface, borderRadius: 8 },
  messageText: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  primaryButton: { backgroundColor: lightAuthColors.text, paddingVertical: 18, borderRadius: 30, marginTop: 12, alignItems: 'center', shadowColor: lightAuthColors.text, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 3 },
  primaryBtnText: { color: lightAuthColors.background, fontWeight: '900', letterSpacing: 1, fontSize: 14 },
  primaryButtonDisabled: { opacity: 0.4 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 32, paddingTop: 16 },
  link: { color: lightAuthColors.textMuted, fontSize: 13, fontWeight: '700' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8, marginBottom: 16 },
  checkbox: { width: 18, height: 18, borderWidth: 1.5, borderColor: lightAuthColors.textMuted, borderRadius: 4, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 2 },
  checkboxActive: { backgroundColor: lightAuthColors.primary, borderColor: lightAuthColors.primary },
  consentText: { flex: 1, color: lightAuthColors.textMuted, fontSize: 11, lineHeight: 18, fontWeight: '600' },
  linkText: { color: lightAuthColors.text, fontWeight: '700', textDecorationLine: 'underline' },
  disclaimerText: { color: lightAuthColors.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 16, fontWeight: '600', marginBottom: 12 }
});