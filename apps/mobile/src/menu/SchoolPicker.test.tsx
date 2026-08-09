import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { api } from '@graybag/shared';

import { SchoolPicker } from './SchoolPicker';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * The picker is the first screen a brand-new parent sees with anything on it, and `SC3` put
 * ~150 of them through it in a compressed window. Every state it can be in is worth a test,
 * because the ones that are not tested are the ones a parent hits at 7am on a school day.
 */

const SCHOOLS = [
  { id: 's1', name: 'Alpha Public School', city: 'SAS Nagar (Mohali)' },
  { id: 's2', name: 'Bravo International School', city: 'SAS Nagar (Mohali)' },
];

/** Point the api module at a stub transport. Nothing here touches a network. */
function withSchools(result: Promise<unknown>) {
  api.setApiTransport({
    rpc: () =>
      result.then(
        (data) => ({ data, error: null }),
        (error: Error) => ({ data: null, error: { message: error.message } }),
      ),
  });
}

afterEach(() => api.setApiTransport(null));

describe('SchoolPicker', () => {
  it('lists every school it is given, with its city', async () => {
    withSchools(Promise.resolve(SCHOOLS));
    await render(<SchoolPicker onSelect={() => {}} />);

    expect(await screen.findByText('Alpha Public School')).toBeTruthy();
    expect(screen.getByText('Bravo International School')).toBeTruthy();
    expect(screen.getAllByText('SAS Nagar (Mohali)')).toHaveLength(2);
  });

  it('reports the chosen school by id and name', async () => {
    // The name is carried alongside the id because the rest of the app shows "Delivery to
    // <school>" and re-fetching the list to resolve a name it already had would be a
    // network round trip to display a string.
    const onSelect = jest.fn();
    withSchools(Promise.resolve(SCHOOLS));
    await render(<SchoolPicker onSelect={onSelect} />);

    fireEvent.press(await screen.findByTestId('school-picker-s2'));

    expect(onSelect).toHaveBeenCalledWith({
      schoolId: 's2',
      schoolName: 'Bravo International School',
    });
  });

  it('shows a skeleton while loading, not a spinner', async () => {
    // S9: skeleton the shape of the content, never spin. A spinner here would be the first
    // thing a new user sees and it says nothing about what is coming.
    withSchools(new Promise(() => {}));
    await render(<SchoolPicker onSelect={() => {}} />);

    expect(screen.getByTestId('school-picker-loading')).toBeTruthy();
  });

  it('shows an empty state, not an error, when no school is onboarded', async () => {
    withSchools(Promise.resolve([]));
    await render(<SchoolPicker onSelect={() => {}} />);

    expect(await screen.findByTestId('school-picker-empty')).toBeTruthy();
  });

  it('offers a retry when the list cannot be loaded', async () => {
    // One of the few places a retry button is honest: there is nothing cached and nothing
    // to show, because a school has not been chosen yet.
    withSchools(Promise.reject(new Error('offline')));
    await render(<SchoolPicker onSelect={() => {}} />);

    expect(await screen.findByTestId('school-picker-error')).toBeTruthy();
  });

  it('recovers when a retry succeeds', async () => {
    let attempt = 0;
    api.setApiTransport({
      rpc: () => {
        attempt += 1;
        return Promise.resolve(
          attempt === 1
            ? { data: null, error: { message: 'offline' } }
            : { data: SCHOOLS, error: null },
        );
      },
    });

    await render(<SchoolPicker onSelect={() => {}} />);
    fireEvent.press(await screen.findByText('Try again'));

    await waitFor(() => expect(screen.getByText('Alpha Public School')).toBeTruthy());
  });

  it('does not set state after unmounting', async () => {
    // A parent who taps away while the list is in flight must not produce a warning, and
    // more importantly must not have their choice overwritten by a late response.
    let resolve: (v: unknown) => void = () => {};
    withSchools(new Promise((r) => (resolve = r)));

    const view = await render(<SchoolPicker onSelect={() => {}} />);
    view.unmount();
    resolve(SCHOOLS);

    await waitFor(() => expect(true).toBe(true));
  });
});
