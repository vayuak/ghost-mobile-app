import React, { createContext, useState, useEffect, useContext } from 'react';
import { Appearance, ColorSchemeName } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const lightTheme = {
  background: '#FFFFFF',
  surface: '#F2F2F7',
  border: '#E5E5EA',
  text: '#000000',
  textMuted: '#8E8E93',
  primary: '#007AFF',
  danger: '#FF3B30',
  warning: '#FFCC00'
};

export const darkTheme = {
  background: '#000000',
  surface: '#1C1C1E',
  border: '#38383A',
  text: '#FFFFFF',
  textMuted: '#8E95A5',
  primary: '#0A84FF',
  danger: '#FF453A',
  warning: '#FFD60A'
};

type ThemeContextType = {
  isDarkMode: boolean;
  colors: typeof darkTheme;
  toggleTheme: (value: boolean) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  isDarkMode: true,
  colors: darkTheme,
  toggleTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  useEffect(() => {
    const loadTheme = async () => {
      const savedTheme = await AsyncStorage.getItem('@app_theme');
      if (savedTheme !== null) {
        setIsDarkMode(savedTheme === 'dark');
      } else {
        const systemPref = Appearance.getColorScheme();
        setIsDarkMode(systemPref === 'dark');
      }
    };
    loadTheme();
  }, []);

  const toggleTheme = async (value: boolean) => {
    setIsDarkMode(value);
    await AsyncStorage.setItem('@app_theme', value ? 'dark' : 'light');
  };

  const colors = isDarkMode ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{ isDarkMode, colors, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);