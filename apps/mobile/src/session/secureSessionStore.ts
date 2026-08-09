import * as SecureStore from 'expo-secure-store';
import type { api } from '@graybag/shared';

/**
 * The device-backed session store — `E03-20`.
 *
 * `expo-secure-store` is the iOS keychain and Android's EncryptedSharedPreferences. A
 * refresh token is a bearer credential valid for 90-180 days (`U3`); on a shared or lost
 * phone, "encrypted at rest behind the device lock" and "a string in a plist" are
 * meaningfully different things, which is why this rather than AsyncStorage.
 *
 * Every method swallows its error and degrades to "no stored session" rather than throwing.
 * A keychain that refuses to read — a backup restored onto a new device is the common
 * cause — must produce a sign-in screen, not a crash on launch before anything renders.
 */
export const secureSessionStore: api.SessionStore = {
  async getItem(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Losing persistence costs one extra OTP on the next launch. Throwing here would
      // cost the sign-in that just succeeded.
    }
  },
  async removeItem(key) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Nothing useful to do; the token expires on its own.
    }
  },
};
