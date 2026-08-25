import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../analytics/analytics';
import { NON_ROUTE_SCREENS } from '../analytics/screens';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { api, design } from '@graybag/shared';

import { Button } from '../components/Button';
import { InlineError } from '../components/motion/InlineError';
import { TextField } from '../components/TextField';
import { useSession } from './SessionContext';

const {
  bg, text, border, action, scale, space, radius, borderWidth, layout, touchTarget,
} = design;

/** Six, and the Supabase project is configured to six. Four would be a different email. */
export const CODE_LENGTH = 6;

/** How long before "Resend" is offered again. `docs/ux-spec.md` §5.9 says 0:30. */
export const RESEND_COOLDOWN_MS = 30_000;

/**
 * Three tries, then the code is spent and the way forward is a new one.
 *
 * This is a **client-side courtesy**, not the security control — Supabase enforces its own
 * limits server-side and nothing here could be trusted to. What it buys is the sentence
 * "2 attempts left", which is the difference between a parent trying the same wrong code
 * four times and a parent going back to look at the email again.
 */
export const MAX_ATTEMPTS = 3;

/**
 * What a backgrounded sign-in leaves behind, so that a remount does not lose it.
 *
 * `docs/ux-spec.md` §5.9.1 requires the digits, the pending address and the countdown to
 * survive **background → foreground and full process death**. Component state survives the
 * first on its own; this module-level draft additionally survives the screen being
 * *unmounted* — a navigator swapping the stack out under a parent who is reading their mail
 * looks identical to them, and re-typing four of six digits is the exact failure §5.9.1
 * names.
 *
 * **It does not survive process death**, and that is stated rather than implied: doing so
 * needs a persistent store, and the one this app has (`secureSessionStore`) is Supabase's
 * session storage. Persisting a live OTP to disk is a decision with a security argument on
 * both sides, so it is left as its own task rather than smuggled in here.
 */
interface PendingSignIn {
  email: string;
  code: string;
  /** An absolute timestamp, never a remaining duration — see `secondsToResend` below. */
  resendAt: number | null;
  attemptsLeft: number;
}

let pending: PendingSignIn | null = null;

/** Drop the draft. Called on a successful sign-in, and by tests between cases. */
export function clearPendingSignIn(): void {
  pending = null;
}

/**
 * Sign in — `E03-14`, `docs/ux-spec.md` §5.8 and §5.9, decision `U1`.
 *
 * ## Two screens' worth of flow on one screen, on purpose
 *
 * Address, then code, in the same place. `SC3` puts ~150 parents through this in a
 * compressed window and `AR7` makes every step a cost, so:
 *
 *   * **No password field.** There is no password (`U1`), and no path that could carry one.
 *   * **No Google or Apple buttons.** They need client ids that do not exist, and a button
 *     that cannot work is a dead end on the one gated screen in the product (`R3`, §5.8).
 *     When the ids exist they go above a divider here; until then the screen must not imply
 *     they are the way in.
 *   * **No "create an account" choice.** Sign up and sign in are the same act — a parent
 *     who has never used GrayBag types their address and gets a code. Asking someone to
 *     classify themselves before they can start is a step that exists for the database's
 *     benefit, not theirs. The "New here?" block is what says so, and §5.8 calls it
 *     load-bearing: a screen headed "Sign in" with no visible way to create an account
 *     reads as broken even when it is working perfectly.
 *   * **No email-verification step after the code** (`AR4`). An OTP cannot succeed on an
 *     address the user cannot read; verification already happened.
 *   * **The address stays on screen** at the code step, with a `Change` affordance, because
 *     the commonest reason a code does not arrive is a typo in the address and the fix must
 *     not be "start again".
 *
 * ## Reached by intent, never on open
 *
 * A stack screen presented modally from checkout. Nothing redirects here, and
 * `RootNavigator.test.tsx` asserts it. The gate is at checkout and nowhere else.
 *
 * ## Nothing here is logged
 *
 * Non-negotiable #4 and the DPDP work: no `console` call in this file carries an address or
 * a code, and none ever should. There is no diagnostic worth having that needs either.
 */
export function SignInScreen({
  onSignedIn,
  readClipboard,
  testID = 'screen-sign-in',
}: {
  onSignedIn?: () => void;
  /**
   * Reads the system clipboard, for the returned-from-background auto-fill (§5.9.1).
   *
   * A **seam, deliberately left unwired.** `expo-clipboard` is not a dependency of this app
   * and adding one was out of scope for this task, so the screen ships with the behaviour
   * built and the source of the string absent: pass `() => Clipboard.getStringAsync()` from
   * the navigator the day the dependency lands and everything below it already works. The
   * two rules §5.9.1 states are enforced here rather than at the call site — an exact
   * six-digit match only, and **never an automatic submit**.
   */
  readClipboard?: () => Promise<string | null> | string | null;
  testID?: string;
}) {
  /**
   * `E15-20`. The funnel's "reached the gate" step, once per mount.
   *
   * `method` is `email_otp` because that is the only route the app offers today — Google
   * one-tap and Sign in with Apple are `E03`'s and not built. Stating the constant rather than
   * inferring one keeps the property honest when they arrive: whoever wires them changes this
   * line, and the allowlist already permits the other two values.
   */
  useEffect(() => {
    track('signin_started', { method: 'email_otp' });
  }, []);


  const { setSession } = useSession();

  const [step, setStep] = useState<'email' | 'code'>(() =>
    pending?.resendAt != null ? 'code' : 'email',
  );
  /**
   * `E15-21`. The code screen is a **state** of this screen, not a route, so the navigator's
   * listener will never emit it — and it is the single most likely place to give up: the code
   * has not arrived, or it went to the wrong inbox.
   *
   * Emitted on entering the step rather than on every render of it.
   */
  useEffect(() => {
    if (step !== 'code') return;
    track('screen_viewed', { screen: NON_ROUTE_SCREENS.signInCode });
  }, [step]);
  const [email, setEmail] = useState(() => pending?.email ?? '');
  const [code, setCode] = useState(() => pending?.code ?? '');
  const [attemptsLeft, setAttemptsLeft] = useState(() => pending?.attemptsLeft ?? MAX_ATTEMPTS);
  const [resendAt, setResendAt] = useState<number | null>(() => pending?.resendAt ?? null);

  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [resent, setResent] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);

  /**
   * The clock, not the countdown.
   *
   * §5.9.1: the countdown is anchored to a **timestamp** and never to an in-memory tick.
   * The interval below only advances "what time is it"; the remaining seconds are always
   * `resendAt − now`. A timer that counted down by decrementing would either restart on
   * return from background (letting someone spam resends) or keep running against a clock
   * that stopped (blocking a legitimate one). Both are the same bug.
   */
  const [now, setNow] = useState(() => Date.now());

  /** Current values for the AppState handler, which outlives any one render's closure. */
  const live = useRef({ step, code });
  live.current = { step, code };

  const secondsToResend =
    resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - now) / 1000));
  const lockedOut = attemptsLeft <= 0;
  const complete = code.length === CODE_LENGTH;

  // The draft, rewritten on every change. Cheap, and it means there is no "save" moment to
  // forget — the state that must survive is the state that is on screen.
  useEffect(() => {
    pending = { email, code, resendAt: step === 'code' ? resendAt : null, attemptsLeft };
  }, [step, email, code, resendAt, attemptsLeft]);

  useEffect(() => {
    if (step !== 'code' || resendAt === null) return undefined;
    const id = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      if (tick >= resendAt) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [step, resendAt]);

  const fillFromClipboard = useCallback(async () => {
    if (readClipboard === undefined) return;
    // Only on the code step, and never over something already typed: a parent who has
    // entered five digits by hand is mid-thought, and replacing them is not help.
    if (live.current.step !== 'code' || live.current.code.length > 0) return;

    let clip: string | null;
    try {
      clip = await readClipboard();
    } catch {
      // A clipboard that will not read is not an error the user needs to hear about; they
      // can still type the code. Deliberately silent, and deliberately not logged.
      return;
    }

    const candidate = (clip ?? '').trim();
    if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(candidate)) return;

    setCode(candidate);
    setAutoFilled(true);
    setCodeError(null);
    // **No submit.** §5.9.1: a code that verifies itself while a parent is still reading is
    // disorienting, and a wrong auto-submit burns one of their three attempts.
  }, [readClipboard]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      // Catch the clock up first. The countdown is a subtraction from `resendAt`, so this is
      // the whole of "the timer survived being backgrounded".
      setNow(Date.now());
      void fillFromClipboard();
    });
    return () => subscription.remove();
  }, [fillFromClipboard]);

  const send = async ({ resend = false }: { resend?: boolean } = {}) => {
    if (sending) return;
    setSending(true);
    setEmailError(null);
    setCodeError(null);
    setOffline(false);
    setResent(false);
    setAutoFilled(false);

    try {
      await api.sendEmailOtp(email);
      const at = Date.now() + RESEND_COOLDOWN_MS;
      setNow(Date.now());
      setResendAt(at);
      setAttemptsLeft(MAX_ATTEMPTS);
      setStep('code');
      if (resend) {
        // The old code is dead; leaving its digits in the boxes invites typing the code from
        // the older of two emails.
        setCode('');
        setResent(true);
      }
    } catch (error) {
      const message = describe(error, 'We could not send that code. Try again in a moment.');
      if (isNetworkFailure(error)) {
        setOffline(true);
      } else if (resend) {
        setCodeError(message);
      } else {
        setEmailError(message);
      }
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (verifying || lockedOut || !complete) return;
    setVerifying(true);
    setCodeError(null);
    setOffline(false);
    setResent(false);
    setAutoFilled(false);

    try {
      const user = await api.verifyEmailOtp(email, code);
      clearPendingSignIn();
      setSession({ status: 'signedIn', userId: user.userId, email: user.email ?? email });
      onSignedIn?.();
    } catch (error) {
      const message = describe(error, 'That code did not work. Try again.');

      if (isNetworkFailure(error)) {
        // The code is kept. An attempt that never reached the server is not an attempt.
        setOffline(true);
      } else if (isRateLimited(message)) {
        // Also not one of theirs — the server refused to look at the code at all.
        setCodeError(message);
      } else {
        const left = attemptsLeft - 1;
        setAttemptsLeft(left);
        setCodeError(
          left <= 0
            ? `${friendly(message)} That is ${MAX_ATTEMPTS} attempts — ask for a new code.`
            : `${friendly(message)} ${left} ${left === 1 ? 'attempt' : 'attempts'} left.`,
        );
        // Locked out means the cooldown is in the way of the only thing left to do.
        if (left <= 0) setResendAt(null);
      }
    } finally {
      setVerifying(false);
    }
  };

  const changeAddress = () => {
    setStep('email');
    setCode('');
    setCodeError(null);
    setEmailError(null);
    setOffline(false);
    setResent(false);
    setAutoFilled(false);
    setResendAt(null);
    setAttemptsLeft(MAX_ATTEMPTS);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      {step === 'email' ? (
        <>
          {/*
            Green, lowercase, and with the wave — §5.8 and the prototype. It is the first
            thing a parent sees on the only screen that stands between them and an order,
            and it is deliberately not the word "Sign in" in a title bar.
          */}
          <Text style={styles.welcome} accessibilityRole="header">
            welcome 👋
          </Text>
          {/*
            Why we are asking NOW. The gate is at checkout (R1), so this sentence is
            answering a question the parent already has, and the second half of it is the
            one that matters: the order they just built is not lost.
          */}
          <Text style={styles.lede}>
            We need an account to place your order. It takes a moment, and your order is kept.
          </Text>

          <TextField
            label="Email"
            value={email}
            onChangeText={(next) => {
              setEmail(next);
              // Typing is the retry. An offline notice that outlives the condition it
              // describes turns into furniture.
              if (offline) setOffline(false);
            }}
            error={emailError}
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

          {offline ? (
            <Notice
              tone="warning"
              title="You're offline"
              body="We can't send a code until you're back on. Nothing is lost — your order is still here."
              testID={`${testID}-offline`}
            />
          ) : null}

          <Button
            label={offline ? "You're offline" : 'Email me a code'}
            onPress={() => void send()}
            loading={sending}
            disabled={offline}
            testID={`${testID}-send`}
          />

          {offline ? (
            <Button
              label="Try again"
              variant="secondary"
              onPress={() => {
                setOffline(false);
                void send();
              }}
              testID={`${testID}-retry`}
            />
          ) : null}

          {/*
            `AR4` makes first sign-in the whole of registration — there is no separate
            register step, by design. But the screen never said so, and a screen headed
            "Sign in" with no visible way to create an account reads as broken even when it
            is working perfectly. Andy hit exactly that and concluded he was blocked on OAuth
            client ids that do not exist. 150 Amity parents will meet this screen cold; a
            tinted block is cheap insurance.
          */}
          <View style={styles.newHere} testID={`${testID}-new-here`}>
            <Text style={styles.newHereTitle}>New here?</Text>
            <Text style={styles.newHereBody}>
              Enter your email and we&rsquo;ll send a code — that is all it takes to create
              your account.
            </Text>
          </View>

          <Text style={styles.quiet}>No passwords, ever.</Text>
        </>
      ) : (
        <>
          <Text style={styles.title} accessibilityRole="header">
            Check your email
          </Text>

          {/* The address is shown, not hidden, because a typo in it is the commonest reason
              a code never arrives — and the fix must not be "start again". */}
          <View style={styles.addressRow}>
            <Text style={styles.lede}>
              We sent a six-digit code to{' '}
              <Text style={styles.address}>{api.normaliseEmail(email)}</Text>
            </Text>
            <Pressable
              onPress={changeAddress}
              accessibilityRole="button"
              accessibilityLabel="Change email address"
              hitSlop={space[3]}
              testID={`${testID}-back`}
            >
              <Text style={styles.change}>Change</Text>
            </Pressable>
          </View>

          {/*
            Six boxes, and one real input behind them.

            The boxes are the control a parent sees; the `TextInput` covering them is what the
            keyboard, the iOS one-time-code suggestion and paste all talk to. Six separate
            inputs — the other way to draw this — means six focus jumps, a backspace that has
            to be special-cased at every boundary, and an autofill that lands in the first box
            and stops.

            **An empty box renders nothing.** Not a placeholder digit, not a dash: the
            prototype used to number them 1–6 and it read as a pre-filled code.
          */}
          <View style={styles.codeField}>
            {/*
              The boxes are hidden from the accessibility tree and the input is not, so a
              screen reader meets **one** control called "Six-digit code" rather than six
              anonymous boxes followed by a field. Hiding them at this level rather than on
              the wrapper matters: `accessibilityElementsHidden` hides the whole subtree, so
              a wrapper carrying it would take the real input with it.
            */}
            <View
              style={styles.boxes}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {Array.from({ length: CODE_LENGTH }, (_, index) => {
                const digit = code[index];
                const isNext = index === code.length && !lockedOut;
                return (
                  <View
                    key={index}
                    testID={`${testID}-box-${index}`}
                    style={[
                      styles.box,
                      digit !== undefined && styles.boxFilled,
                      isNext && styles.boxNext,
                      autoFilled && digit !== undefined && styles.boxAutoFilled,
                    ]}
                  >
                    {digit === undefined ? null : <Text style={styles.digit}>{digit}</Text>}
                    {isNext ? <View style={styles.caret} /> : null}
                  </View>
                );
              })}
            </View>
            <TextInput
              value={code}
              // The keyboard opens with the step. A parent who has just been told to check
              // their email is coming back here to type six digits and nothing else.
              autoFocus
              onChangeText={(next) => {
                setCode(next.replace(/\D/g, '').slice(0, CODE_LENGTH));
                setAutoFilled(false);
                if (offline) setOffline(false);
              }}
              // Zero opacity is structural rather than a style choice: this input is the
              // keyboard surface, and the boxes above are the rendered control. It is not a
              // colour, so there is no token that would say it.
              style={styles.hiddenInput}
              accessibilityLabel="Six-digit code"
              editable={!lockedOut}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={CODE_LENGTH}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              returnKeyType="done"
              onSubmitEditing={() => void verify()}
              testID={`${testID}-code`}
            />
          </View>

          <InlineError message={codeError} testID={`${testID}-code-error`} />

          {autoFilled ? (
            <Notice
              tone="info"
              title="We filled in the code we found"
              body="It was on your clipboard. Check it against the email, then tap Verify."
              testID={`${testID}-autofilled`}
            />
          ) : null}

          {resent ? (
            <Notice
              tone="info"
              title="New code sent"
              body="Use the newest email — the earlier code no longer works."
              testID={`${testID}-resent`}
            />
          ) : null}

          {offline ? (
            <Notice
              tone="warning"
              title="You're offline"
              body="We couldn't check that code. Your code is still here — try again when you're back on."
              testID={`${testID}-offline`}
            />
          ) : null}

          <Button
            label={
              lockedOut ? 'Ask for a new code' : complete ? 'Verify' : 'Enter the code'
            }
            onPress={() => void verify()}
            loading={verifying}
            disabled={!complete || lockedOut}
            testID={`${testID}-verify`}
          />

          {/*
            One element for both halves of the resend, so there is one thing to find rather
            than a button that appears where a sentence was. Cooling down it is a statement;
            at zero it is a control.
          */}
          <Pressable
            onPress={() => void send({ resend: true })}
            disabled={secondsToResend > 0 || sending}
            accessibilityRole="button"
            accessibilityState={{ disabled: secondsToResend > 0 || sending }}
            accessibilityLabel={
              secondsToResend > 0
                ? `You can ask for a new code in ${formatCountdown(secondsToResend)}`
                : 'Send a new code'
            }
            hitSlop={space[2]}
            testID={`${testID}-resend`}
          >
            <Text style={secondsToResend > 0 ? styles.quiet : styles.resendReady}>
              {secondsToResend > 0
                ? `Resend in ${formatCountdown(secondsToResend)}`
                : 'Send a new code'}
            </Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

/**
 * A tinted block. Not `ErrorState` — that is a whole-screen composition with a retry, and
 * every use here is a sentence beside a control that still works.
 */
function Notice({
  tone,
  title,
  body,
  testID,
}: {
  tone: 'info' | 'warning';
  title: string;
  body: string;
  testID: string;
}) {
  const warning = tone === 'warning';
  return (
    <View style={[styles.notice, warning && styles.noticeWarning]} testID={testID}>
      <Text style={[styles.noticeTitle, warning && styles.noticeWarningInk]}>{title}</Text>
      <Text style={[styles.noticeBody, warning && styles.noticeWarningInk]}>{body}</Text>
    </View>
  );
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback;
}

/**
 * A failure that never reached the server.
 *
 * There is no connectivity library in this app, so "offline" is only knowable from a
 * request that could not be made — which is the honest version anyway: a reachability flag
 * that says "connected" on a hotel wifi with no route out is worse than no flag.
 */
function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /network request failed|network error|failed to fetch|offline|timed? ?out/i.test(
    error.message,
  );
}

function isRateLimited(message: string): boolean {
  return /too many attempts|rate limit/i.test(message);
}

/**
 * The provider's wording, in ours.
 *
 * Supabase returns one message — "Token has expired or is invalid" — for both a wrong code
 * and an expired one, because from the server they are the same row not matching. The two
 * are separate states in §5.9 and we genuinely cannot tell them apart, so the copy says
 * both rather than picking one and being wrong half the time. "Token" is the only word
 * changed: it is the provider's noun, and no parent has one.
 */
function friendly(message: string): string {
  if (/expired or is invalid/i.test(message)) return 'That code has expired or is invalid.';
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: bg.canvas },
  content: { padding: layout.gutter, gap: layout.blockGap },

  welcome: {
    // `text.link` is `primary-700`. The brand green `#00af52` is 2.9:1 on white — legal as a
    // graphic and illegal as ink (`S6`), which is why the green heading in the prototype is
    // this green and not that one. Same substitution `MenuScreen` and `SectionHeading` make.
    color: text.link,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
    // `tracking` is em, as `css.ts` emits it; React Native's `letterSpacing` is points.
    letterSpacing: scale.h1.tracking * scale.h1.size,
  },
  title: {
    color: text.primary,
    fontSize: scale.h1.size,
    lineHeight: scale.h1.lineHeight,
    fontWeight: scale.h1.weight,
    // `tracking` is em, as `css.ts` emits it; React Native's `letterSpacing` is points.
    letterSpacing: scale.h1.tracking * scale.h1.size,
  },
  lede: {
    color: text.secondary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    flexShrink: 1,
  },
  address: { color: text.primary, fontWeight: scale.bodyStrong.weight },

  addressRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[2],
    marginBottom: space[2],
  },
  change: {
    color: text.link,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
  },

  codeField: { position: 'relative' },
  boxes: { flexDirection: 'row', gap: space[2] },
  box: {
    flex: 1,
    minHeight: touchTarget.min,
    aspectRatio: 0.86,
    borderRadius: radius.md,
    backgroundColor: bg.surfaceMuted,
    borderWidth: borderWidth.default,
    borderColor: bg.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A filled box is tinted, so how much is entered is readable at a glance rather than by
  // counting digits.
  //
  // `action.secondaryBg` rather than `bg.surfaceAccent`: a filled box is a **control** in a
  // selected state, which is what the tonal fill is for, and the accent surface is lime —
  // the right role for a card and the wrong colour for a green control. Its ink,
  // `action.secondaryFg`, is 8.68 on it.
  boxFilled: { backgroundColor: action.secondaryBg, borderColor: action.secondaryBg },
  // The next box is the only outlined one — `border.brand` is the selected/active outline,
  // and it clears the 3:1 boundary bar that `border.default` does not.
  boxNext: {
    backgroundColor: bg.surface,
    borderColor: border.brand,
    borderWidth: borderWidth.emphasis,
  },
  // Auto-filled digits are highlighted rather than announced by movement — §5.9.1 wants the
  // parent to look at them before tapping Verify.
  boxAutoFilled: { borderColor: border.brand, borderWidth: borderWidth.emphasis },
  digit: {
    color: action.secondaryFg,
    fontSize: scale.h2.size,
    lineHeight: scale.h2.lineHeight,
    fontWeight: scale.h2.weight,
    fontVariant: ['tabular-nums'],
  },
  caret: {
    width: borderWidth.emphasis,
    height: scale.h2.size,
    borderRadius: radius.xs,
    backgroundColor: border.brand,
  },
  // Covers the boxes exactly, so a tap anywhere on the row lands in the field. Written out
  // rather than `StyleSheet.absoluteFillObject`, which React Native 0.86 no longer types —
  // spreading it silently contributes nothing, and the input ends up unpositioned.
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
  },

  newHere: {
    backgroundColor: bg.surfaceAccent,
    borderRadius: radius.lg,
    padding: layout.cardPadding,
    gap: space[1],
  },
  // `text.onAccent` is forest-500, the declared substitute on a lime card: `text.link` is
  // 4.09 there and fails.
  newHereTitle: {
    color: text.onAccent,
    fontSize: scale.bodyStrong.size,
    lineHeight: scale.bodyStrong.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  newHereBody: {
    color: text.primary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },

  notice: {
    backgroundColor: bg.surfaceAccent,
    borderRadius: radius.md,
    padding: space[3],
    gap: space[1],
  },
  noticeWarning: { backgroundColor: bg.surfaceWarning },
  noticeTitle: {
    color: text.onAccent,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
    fontWeight: scale.bodyStrong.weight,
  },
  noticeBody: {
    color: text.primary,
    fontSize: scale.bodySm.size,
    lineHeight: scale.bodySm.lineHeight,
  },
  noticeWarningInk: { color: text.warning },

  quiet: {
    color: text.tertiary,
    fontSize: scale.caption.size,
    lineHeight: scale.caption.lineHeight,
    textAlign: 'center',
  },
  resendReady: {
    color: text.link,
    fontSize: scale.label.size,
    lineHeight: scale.label.lineHeight,
    fontWeight: scale.label.weight,
    textAlign: 'center',
  },
});
