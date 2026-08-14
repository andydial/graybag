import { render, screen, fireEvent } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { UpdateRequiredScreen } from './UpdateRequiredScreen';

/**
 * `E17-46`. The screen a parent on an old build sees after the 19th.
 *
 * `Linking` is mocked rather than injected — an `openStore` prop was the first shape and
 * `orphans.test.ts` refused it, correctly: an optional prop nothing but a test passes is
 * indistinguishable from a caller somebody forgot to wire. Mocking the module means the path
 * under test is the path that ships.
 */
const openURL = jest.spyOn(Linking, 'openURL');

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const show = async (props: Parameters<typeof UpdateRequiredScreen>[0] = {}) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <UpdateRequiredScreen {...props} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  openURL.mockReset();
  openURL.mockResolvedValue(true);
});

describe('UpdateRequiredScreen', () => {
  it('always says something, even with no configured message', async () => {
    // A config row that has not been given a message must not produce an empty dialog. The
    // default is the thing a parent actually reads in the common case.
    await show();
    expect(screen.getByTestId('screen-update-required-message')).toHaveTextContent(
      /too old to order with/,
    );
  });

  it('prefers the server’s sentence, so the wording changes without a deploy', async () => {
    // The whole reason the floor and its copy are data rather than constants.
    await show({ message: 'GrayBag has moved. Please update by Friday.' });
    expect(screen.getByTestId('screen-update-required-message')).toHaveTextContent(
      'GrayBag has moved. Please update by Friday.',
    );
  });

  it('offers the store, which is the only real exit', async () => {
    await show();
    fireEvent.press(screen.getByTestId('screen-update-required-store'));
    expect(openURL).toHaveBeenCalled();
    // A SEARCH url. Neither store id is recorded in this repository (`E17-33` is open on the
    // Play versionName, and the iOS id has never been written down), and a guessed id opens
    // the wrong app silently.
    expect(String(openURL.mock.calls[0]?.[0])).toMatch(/GrayBag/);
  });

  it('falls back to a web store URL when the store scheme is unavailable', async () => {
    // A simulator, or a device without Play. Failing silently would leave the only exit dead.
    openURL.mockRejectedValueOnce(new Error('no handler'));
    await show();
    fireEvent.press(screen.getByTestId('screen-update-required-store'));

    await new Promise((r) => setTimeout(r, 0));
    expect(openURL).toHaveBeenCalledTimes(2);
    expect(String(openURL.mock.calls[1]?.[0])).toMatch(/^https:/);
  });

  it('shows the floor as a diagnostic when there is one, and nothing when there is not', async () => {
    const first = await show({ minimumVersion: '4.0.0' });
    expect(screen.getByTestId('screen-update-required-minimum')).toHaveTextContent(/4\.0\.0/);
    first.unmount();

    await show();
    expect(screen.queryByTestId('screen-update-required-minimum')).toBeNull();
  });

  it('carries no user data of any kind', async () => {
    // It renders before anyone has signed in, and it is the screen most likely to be
    // screenshotted and pasted into a support thread (`R6`, non-negotiable #4).
    const { toJSON } = await show({
      message: 'Please update.',
      minimumVersion: '4.0.0',
    });
    const tree = JSON.stringify(toJSON());
    expect(tree).not.toContain('@');
  });
});
