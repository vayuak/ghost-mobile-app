import React, { useState, useEffect } from 'react';
import { Text, View, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { apiClient } from '../services/api';

export default function AuthScreen({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [currentMode, setCurrentMode] = useState<'LOGIN' | 'REGISTER' | 'FORGOT_PASSWORD'>('LOGIN');
  const [workflowStep, setWorkflowStep] = useState<1 | 2>(1); 
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [contactId, setContactId] = useState(''); 
  const [otpCode, setOtpCode] = useState('');
  
  const [uiMessage, setUiMessage] = useState<{ text: string, type: 'error' | 'success' } | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<'AVAILABLE' | 'TAKEN' | null>(null);

  useEffect(() => {
    if (currentMode !== 'REGISTER' || username.length < 3) {
      setUsernameStatus(null);
      return;
    }
    const checkUsername = async () => {
      try {
        const res = await apiClient.get(`/v1/auth/check-username?username=${username}`);
        setUsernameStatus(res.available ? 'AVAILABLE' : 'TAKEN');
      } catch (e) {
        setUsernameStatus(null);
      }
    };
    const delayDebounceFn = setTimeout(() => checkUsername(), 500);
    return () => clearTimeout(delayDebounceFn);
  }, [username, currentMode]);

  const isValidEmail = (email: string) => {
    const strictEmailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return strictEmailRegex.test(email);
  };

  const isStrongPassword = (pass: string) => {
    return pass.length >= 8 && /[A-Z]/.test(pass) && /[0-9]/.test(pass) && /[^A-Za-z0-9]/.test(pass);
  };

const sanitizeError = (err: any) => {
    if (err?.response?.data && typeof err.response.data === 'object' && !err.response.data.error) {
       const firstErrorKey = Object.keys(err.response.data)[0];
       return err.response.data[firstErrorKey] || 'Invalid input provided.';
    }

    const msg = err?.message?.toLowerCase() || err?.response?.data?.error?.toLowerCase() || '';
    
    // 🟢 FIX: Prioritize exact string matches from the backend first!
    if (msg.includes('incorrect email') || msg.includes('invalid identity') || msg.includes('bad credentials')) return 'Incorrect email or password. Please try again or register.';
    
    if (msg.includes('contact method') || msg.includes('platform footprint')) return 'This email is already registered. Please return to login.';
    if (msg.includes('identity signature') || msg.includes('infrastructure')) return 'This username is already taken. Please choose another.';
    if (msg.includes('processing active') || msg.includes('handshake protocol')) return 'A verification code was recently sent to this email. Please wait 10 minutes before trying again.';
    if (msg.includes('staging window lost')) return 'Your verification session expired. Please register again.';
    if (msg.includes('too many invalid attempts')) return 'Too many invalid attempts. Please request a new code.';
    if (msg.includes('no active registration handshake')) return 'Verification failed. The code may have expired, or you need to restart the app.';
    if (msg.includes('not found') || msg.includes('404')) return 'We could not find an account with that email.';
    if (msg.includes('network') || msg.includes('timeout')) return 'Network error. Please check your internet connection.';
    
    // 🟢 FIX: Removed the greedy 'mail' check so it only triggers on actual SMTP failures
    if (msg.includes('deliver') || msg.includes('smtp') || msg.includes('connection refused')) return 'We could not deliver the email. Please check if the address is typed correctly.';
    
    if (msg.includes('500') || msg.includes('internal')) return 'Something went wrong on our end. Please try again later.';
    
    return err?.response?.data?.error || err?.message || 'An unexpected error occurred. Please try again.';
  };

  const validateInput = () => {
    if (currentMode === 'REGISTER' || currentMode === 'FORGOT_PASSWORD') {
      if (!isValidEmail(contactId.trim())) {
        setUiMessage({ text: 'Please enter a valid email address (e.g., name@domain.com).', type: 'error' });
        return false;
      }
    }
    if (currentMode === 'REGISTER') {
      if (!isStrongPassword(password)) {
        setUiMessage({ text: 'Password must be at least 8 characters and include 1 uppercase letter, 1 number, and 1 special character.', type: 'error' });
        return false;
      }
      if (usernameStatus === 'TAKEN') {
        setUiMessage({ text: 'Username is already taken.', type: 'error' });
        return false;
      }
    }
    return true;
  };

  const handleLogin = async () => {
    setUiMessage(null);
    if (!contactId || !password) return setUiMessage({ text: 'Email and password are required.', type: 'error' });
    setLoading(true);
    try {
      const res = await apiClient.post('/v1/auth/login', { identifier: contactId.trim(), password });
      const jwtToken = res.jwt || res.token;
      if (jwtToken) {
        await AsyncStorage.setItem('@ghost_token', jwtToken);
        const isolatedHandle = contactId.includes('@') ? contactId.split('@')[0] : contactId;
        await AsyncStorage.setItem('@active_username', isolatedHandle);
        onAuthSuccess(); 
      }
    } catch (err: any) { 
      setUiMessage({ text: sanitizeError(err), type: 'error' }); 
    } finally { setLoading(false); }
  };

  const handleRegister = async () => {
    setUiMessage(null);
    if (!username || !password || !contactId) return setUiMessage({ text: 'All fields are mandatory.', type: 'error' });
    if (!validateInput()) return;
    
    setLoading(true);
    try {
      await apiClient.post('/v1/auth/register', { 
        username: username.toLowerCase().trim(), 
        password, 
        contactIdentifier: contactId.trim() 
      });
      setUiMessage({ text: `Verification code sent to ${contactId.trim()}`, type: 'success' }); 
      setWorkflowStep(2); 
    } catch (err: any) { 
      setUiMessage({ text: sanitizeError(err), type: 'error' }); 
    } finally { setLoading(false); }
  };

  const handleForgotPassword = async () => {
    setUiMessage(null);
    if (!contactId) return setUiMessage({ text: 'Email address is required.', type: 'error' });
    if (!validateInput()) return;

    setLoading(true);
    try {
      await apiClient.post('/v1/auth/forgot-password', { identifier: contactId.trim() });
      setUiMessage({ text: `Recovery code sent to ${contactId.trim()}`, type: 'success' });
      setWorkflowStep(2);
    } catch (err: any) { 
      setUiMessage({ text: sanitizeError(err), type: 'error' }); 
    } finally { setLoading(false); }
  };

  const handleVerifyOtp = async () => {
    setUiMessage(null);
    if (currentMode === 'FORGOT_PASSWORD' && !isStrongPassword(password)) {
        return setUiMessage({ text: 'Your new password must be at least 8 characters...', type: 'error' });
    }

    setLoading(true);
    try {
      if (currentMode === 'FORGOT_PASSWORD') {
        await apiClient.post('/v1/auth/reset-password', { 
          identifier: contactId.trim(), 
          newPassword: password, 
          otp: otpCode.trim() 
        });
        setUiMessage({ text: 'Password reset successful. Returning to login.', type: 'success' });
      } else {
        const cleanTarget = (username || contactId).toLowerCase().trim();
        await apiClient.post('/v1/auth/verify-otp', { 
          username: cleanTarget, 
          otp: otpCode.trim() 
        });
        setUiMessage({ text: 'Verification complete. You can now login.', type: 'success' });
      }
      setTimeout(() => {
        setWorkflowStep(1);
        setCurrentMode('LOGIN');
        // 🟢 FIX: We ONLY clear the password and OTP. 
        // The `contactId` remains populated so the user's email is already typed in!
        setPassword('');
        setOtpCode('');
      }, 2000);
    } catch (err: any) { 
      setUiMessage({ text: sanitizeError(err), type: 'error' }); 
    } finally { setLoading(false); }
  };

  const executePrimaryAction = () => {
    if (currentMode === 'LOGIN') handleLogin();
    else if (currentMode === 'REGISTER') handleRegister();
    else handleForgotPassword();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: '#000000' }}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.brandTitle}>GHOST SHIELD</Text>
        <Text style={styles.brandSubtitle}>SECURE TERMINAL</Text>

        <View style={styles.card}>
          <Text style={styles.modeText}>[{currentMode} PROTOCOL]</Text>

          {workflowStep === 1 ? (
            <>
              {currentMode === 'REGISTER' && (
                <>
                  <Text style={styles.label}>Username</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="username" placeholderTextColor="#404040" autoCapitalize="none"/>
                    {usernameStatus === 'AVAILABLE' && <Text style={[styles.statusTextRight, { color: '#00C851' }]}>[ √ ]</Text>}
                    {usernameStatus === 'TAKEN' && <Text style={[styles.statusTextRight, { color: '#FF4444' }]}>[ X ]</Text>}
                  </View>
                </>
              )}
              
              <Text style={styles.label}>{currentMode === 'LOGIN' ? 'Email or Username' : 'Email'}</Text>
              <TextInput style={styles.input} value={contactId} onChangeText={setContactId} placeholder="email@domain.com" placeholderTextColor="#404040" autoCapitalize="none" keyboardType="email-address"/>

              {currentMode !== 'FORGOT_PASSWORD' && (
                <>
                  <Text style={styles.label}>Password</Text>
                  <View style={styles.passwordContainer}>
                    <TextInput style={styles.passwordInput} value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor="#404040" secureTextEntry={!showPassword} autoCapitalize="none"/>
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                      <Feather name={showPassword ? "eye" : "eye-off"} size={18} color="#666666" />
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {uiMessage && (
                <View style={styles.messageBox}>
                  <Text style={[styles.messageText, uiMessage.type === 'error' ? { color: '#FF4444' } : { color: '#00C851' }]}>
                    {uiMessage.text}
                  </Text>
                </View>
              )}

              <TouchableOpacity style={styles.primaryButton} onPress={executePrimaryAction}>
                {loading ? <ActivityIndicator color="#666666"/> : <Text style={styles.primaryBtnText}>{currentMode === 'LOGIN' ? 'LOGIN' : currentMode === 'REGISTER' ? 'REGISTER' : 'SEND RESET CODE'}</Text>}
              </TouchableOpacity>

              <View style={styles.toggleRow}>
                {currentMode === 'LOGIN' ? (
                  <>
                    <TouchableOpacity onPress={() => { setCurrentMode('REGISTER'); setUiMessage(null); }}><Text style={styles.link}>New User? Register</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => { setCurrentMode('FORGOT_PASSWORD'); setUiMessage(null); }}><Text style={styles.link}>Forgot Password?</Text></TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity onPress={() => { setCurrentMode('LOGIN'); setUiMessage(null); }}><Text style={styles.link}>Return to Login</Text></TouchableOpacity>
                )}
              </View>
            </>
          ) : (
            <>
              {currentMode === 'FORGOT_PASSWORD' && (
                <>
                  <Text style={styles.label}>New Password</Text>
                  <View style={styles.passwordContainer}>
                    <TextInput style={styles.passwordInput} value={password} onChangeText={setPassword} placeholder="••••••••" placeholderTextColor="#404040" secureTextEntry={!showPassword} autoCapitalize="none"/>
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                      <Feather name={showPassword ? "eye" : "eye-off"} size={18} color="#666666" />
                    </TouchableOpacity>
                  </View>
                </>
              )}
              <Text style={styles.label}>6-Digit Verification Code</Text>
              <TextInput style={[styles.input, { fontSize: 24, letterSpacing: 10, textAlign: 'center', marginTop: 16 }]} value={otpCode} onChangeText={setOtpCode} placeholder="------" placeholderTextColor="#404040" keyboardType="number-pad" maxLength={6}/>
              
              {uiMessage && (
                <View style={styles.messageBox}>
                  <Text style={[styles.messageText, uiMessage.type === 'error' ? { color: '#FF4444' } : { color: '#00C851' }]}>
                    {uiMessage.text}
                  </Text>
                </View>
              )}

              <TouchableOpacity style={styles.primaryButton} onPress={handleVerifyOtp}>
                {loading ? <ActivityIndicator color="#666666"/> : <Text style={styles.primaryBtnText}>VERIFY CODE</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#000000', padding: 24, justifyContent: 'center' }, 
  brandTitle: { color: '#666666', fontSize: 28, fontWeight: '900', letterSpacing: 6, textAlign: 'center' },
  brandSubtitle: { color: '#404040', fontSize: 10, fontWeight: '600', letterSpacing: 8, textAlign: 'center', marginBottom: 40 },
  card: { backgroundColor: '#1A1A1A', padding: 24, borderWidth: 1, borderColor: '#262626' }, 
  modeText: { color: '#666666', fontSize: 12, fontWeight: '800', textAlign: 'center', marginBottom: 24, letterSpacing: 2 },
  label: { color: '#404040', fontSize: 10, fontWeight: '800', marginBottom: 6, marginTop: 16, textTransform: 'uppercase', letterSpacing: 1 },
  inputWrapper: { position: 'relative', justifyContent: 'center' },
  statusTextRight: { position: 'absolute', right: 14, fontWeight: 'bold' },
  input: { backgroundColor: '#262626', color: '#666666', padding: 14, borderWidth: 1, borderColor: '#404040', fontSize: 14, fontWeight: '600' },
  passwordContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#404040', backgroundColor: '#262626' },
  passwordInput: { flex: 1, padding: 14, color: '#666666', fontSize: 14, fontWeight: '600' },
  eyeIcon: { padding: 14 },
  messageBox: { marginTop: 16, padding: 12, backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#404040' },
  messageText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },
  primaryButton: { backgroundColor: '#262626', padding: 16, marginTop: 24, alignItems: 'center', borderWidth: 1, borderColor: '#404040' },
  primaryBtnText: { color: '#666666', fontWeight: '900', letterSpacing: 2 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 30, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#262626' },
  link: { color: '#666666', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' }
});