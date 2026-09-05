import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

export interface LocationCoords {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export const useHighAccuracyLocation = () => {
  const [coords, setCoords] = useState<LocationCoords | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let subscriber: Location.LocationSubscription | null = null;

    const startLocationTracking = async () => {
      // 1. Request Foreground Permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }

      // 2. Fetch Initial Instant Position
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation, // Highest precision possible
      });

      setCoords({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        accuracy: current.coords.accuracy,
      });

      // 3. Watch Position Continuously (Triggers ping only when moving > 2 meters)
      subscriber = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Highest,
          timeInterval: 5000, // Check position every 5 seconds
          distanceInterval: 2, // Update ONLY if user moves at least 2 meters
        },
        (location) => {
          setCoords({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            accuracy: location.coords.accuracy,
          });
        }
      );
    };

    startLocationTracking();

    return () => {
      if (subscriber) subscriber.remove();
    };
  }, []);

  return { coords, errorMsg };
};