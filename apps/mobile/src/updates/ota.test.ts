import { applyUpdateNow, fetchUpdateInBackground, type UpdatesApi } from './ota';

function fakeUpdates(over: Partial<UpdatesApi> = {}): UpdatesApi {
  return {
    isEnabled: true,
    checkForUpdateAsync: async () => ({ isAvailable: false }),
    fetchUpdateAsync: async () => ({ isNew: false }),
    reloadAsync: async () => {},
    ...over,
  };
}

describe('fetchUpdateInBackground', () => {
  it('reports disabled in Expo Go and dev clients', async () => {
    await expect(fetchUpdateInBackground(fakeUpdates({ isEnabled: false }))).resolves.toEqual({
      status: 'disabled',
    });
  });

  it('reports none when there is nothing new', async () => {
    await expect(fetchUpdateInBackground(fakeUpdates())).resolves.toEqual({ status: 'none' });
  });

  it('downloads an available update and reports it ready', async () => {
    const Updates = fakeUpdates({
      checkForUpdateAsync: async () => ({ isAvailable: true }),
      fetchUpdateAsync: async () => ({ isNew: true }),
    });
    await expect(fetchUpdateInBackground(Updates)).resolves.toEqual({ status: 'ready' });
  });

  /**
   * The property that matters most. An update check is not something the user asked for, so a
   * failed one must be invisible to them — the app they have works, and the right behaviour
   * on a bad network is to carry on with it (`P8`, `MC3`). Throwing here would turn a routine
   * offline moment into an error screen.
   */
  it('never throws, whatever the network does', async () => {
    const boom = async () => {
      throw new Error('offline');
    };
    await expect(
      fetchUpdateInBackground(fakeUpdates({ checkForUpdateAsync: boom })),
    ).resolves.toMatchObject({ status: 'failed' });
    await expect(
      fetchUpdateInBackground(fakeUpdates({
        checkForUpdateAsync: async () => ({ isAvailable: true }),
        fetchUpdateAsync: boom,
      })),
    ).resolves.toMatchObject({ status: 'failed' });
  });

  /**
   * Fetching must NEVER apply. Reloading under a user is the one thing OTA can do that a
   * store release cannot, and doing it mid-checkout is how a payment ends up in a state
   * nobody can reconcile (`L4`, `[OL-05]`).
   */
  it('does not reload as a side effect of fetching', async () => {
    const reloadAsync = jest.fn(async () => {});
    const Updates = fakeUpdates({
      checkForUpdateAsync: async () => ({ isAvailable: true }),
      fetchUpdateAsync: async () => ({ isNew: true }),
      reloadAsync,
    });
    await fetchUpdateInBackground(Updates);
    expect(reloadAsync).not.toHaveBeenCalled();
  });

  it('does not fetch when nothing is available', async () => {
    const fetchUpdateAsync = jest.fn(async () => ({ isNew: true }));
    await fetchUpdateInBackground(fakeUpdates({ fetchUpdateAsync }));
    expect(fetchUpdateAsync).not.toHaveBeenCalled();
  });

  it('does not check at all when updates are disabled', async () => {
    const checkForUpdateAsync = jest.fn(async () => ({ isAvailable: true }));
    await fetchUpdateInBackground(fakeUpdates({ isEnabled: false, checkForUpdateAsync }));
    expect(checkForUpdateAsync).not.toHaveBeenCalled();
  });
});

describe('applyUpdateNow', () => {
  it('reloads, and is the only thing that does', async () => {
    const reloadAsync = jest.fn(async () => {});
    await applyUpdateNow(fakeUpdates({ reloadAsync }));
    expect(reloadAsync).toHaveBeenCalledTimes(1);
  });
});
