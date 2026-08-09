import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api, design } from '@graybag/shared';

import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { useSession } from './SessionContext';

const { bg, text, scale, space, layout } = design;

/**
 * Sign in — `E03-14`, decision `U1`.
 *
 * ## Two screens' worth of flow on one screen, on purpose
 *
 * Address, then code, in the same place with the same heading. `SC3` puts ~150 parents
 * through this in a compressed window and `AR7` makes every step a cost, so:
 *
 *   * **No password field.** There is no password (`U1`), and no path that could carry one.
 *   * **No "create an account" choice.** Sign up and sign in are the same act — a parent
 *     who has never used GrayBag types their address and gets a code. Asking someone to
 *     classify themselves before they can start is a step that exists for the database's
 *     benefit, not theirs.
 *   * **No email-verification step after the code** (`AR4`). An OTP cannot succeed on an
 *     address the user cannot read; verification already happened.
 *   * **The address stays on screen** at the code step, with a way back, because the
 *     commonest reason a code does not arrive is a typo in the address and the fix must not
 *     be "start again".
 *
 * ## Reached by intent, never on open
 *
 * This is a stack screen presented modally from checkout. Nothing redirects here, and
 * `RootNavigator.test.tsx` asserts it. The gate is at checkout and nowhere else.
 */
export function SignInScreen({
  onSignedIn,
  testID = 'screen-sign-in',
}: {
  onSignedIn?: () => void;
  testID?: string;
}) {
  const { setSession } = useSession();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.sendEmailOtp(email);
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const user = await api.verifyEmailOtp(email, code);
      setSession({ status: 'signedIn', userId: user.userId });
      onSignedIn?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen} testID={testID}>
      <Text style={styles.title} accessibilityRole="header">
        {step === 'email' ? 'Sign in to order' : 'Enter your code'}
      </Text>

      {step === 'email' ? (
        <>
          <Text style={styles.body}>
            We will email you a six-digit code. No password to remember.
          </Text>
          <TextField
            label="Email address"
            value={email}
            onChangeText={setEmail}
            error={error}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={() => void send()}
            testID={`${testID}-email`}
          />
          <Button
            label={busy ? 'Sending…' : 'Email me a code'}
            onPress={() => void send()}
            disabled={busy}
            testID={`${testID}-send`}
          />
        </>
      ) : (
        <>
          {/* The address is shown, not hidden, because a typo in it is the commonest
              reason a code never arrives — and the fix must not be "start again". */}
          <Text style={styles.body}>
            We sent a code to {api.normaliseEmail(email)}.
          </Text>
          <TextField
            label="Six-digit code"
            value={code}
            onChangeText={setCode}
            error={error}
            placeholder="123456"
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="done"
            onSubmitEditing={() => void verify()}
            testID={`${testID}-code`}
          />
          <Button
            label={busy ? 'Checking…' : 'Sign in'}
            onPress={() => void verify()}
            disabled={busy}
            testID={`${testID}-verify`}
          />
          <Button
            label="Use a different address"
            variant="secondary"
            onPress={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
            testID={`${testID}-back`}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: bg.canvas,
    padding: layout.gutter,
    gap: space[3],
  },
  title: {
    fontSize: scale.h1.size,
    fontWeight: scale.h1.weight,
    color: text.primary,
  },
  body: {
    fontSize: scale.body.size,
    color: text.secondary,
  },
});
