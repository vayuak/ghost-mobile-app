import { Platform } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { Video } from 'react-native-compressor';

export const compressMedia = async (uri: string, mediaType: 'image' | 'video' | string): Promise<string> => {
  if (Platform.OS === 'web') return uri; // Skip compression on web

  try {
    if (mediaType.includes('video')) {
      // 🟢 Video Compression: Auto-crushes bitrates while maintaining 720p/1080p
      console.log('Compressing video...');
      const compressedVideoUri = await Video.compress(
        uri,
        {
          compressionMethod: 'auto',
          minimumFileSizeForCompress: 5, // Don't compress if under 5MB
        },
        (progress) => {
          console.log('Compression Progress: ', progress);
        }
      );
      return compressedVideoUri;
    } else {
      // 🟢 Image Compression: Resize max width to 1080px, compress to 70% quality, force JPEG
      console.log('Compressing image...');
      const compressedImage = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: 1080 } }], 
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      return compressedImage.uri;
    }
  } catch (error) {
    console.error('Compression failed, falling back to original:', error);
    return uri; // If compression fails, upload the original so the app doesn't break
  }
};