import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { api } from '@graybag/shared';

import { SIGN_IN_TEST_ID, SchoolPicker, clearSchoolListCache } from './SchoolPicker';

// `render` is async on RNTL v14 — see docs/learnings.md 2026-08-09.

/**
 * The picker is the first screen a brand-new parent sees with anything on it — since
 * `docs/ux-spec.md` §6.1.1 cut Welcome into it, it is the *only* screen they see before the
 * menu — and `SC3` put ~150 of them through it in a compressed window. Every state it can be
 * in is worth a test, because the ones that are not tested are the ones a parent hits at 7am
 * on a school day.
 *
 * The state that gets the most attention here is the split §5.21 exists for: "no school
 * matches what you typed" and "we could not load the list" are different sentences, different
 * recoveries and different testIDs, and they were the same thing once.
 */

// Shaped as PostgREST returns them: the city is an embedded to-one relation.
const SCHOOLS = [
  { id: 's1', name: 'Alpha Public School', city: { name: 'SAS Nagar (Mohali)' } },
  { id: 's2', name: 'Bravo International School', city: { name: 'SAS Nagar (Mohali)' } },
  { id: 's3', name: 'Chandra College', city: { name: 'Kharar' } },
];

/**
 * Point the api module at a stub transport. Nothing here touches a network.
 *
 * The builder is fluent and thenable because that is the shape `fetchSchools` uses after
 * [AUTH-01] moved the read from an RPC onto the `school` table (migration 0012).
 */
function withSchools(result: Promise<unknown>) {
  // Mark the promise handled the moment it is created. `settle()` attaches the real
  // handlers, but it does not run until the component's effect asks for the list — and a
  // rejection that spends a macrotask unattended is an unhandled rejection, which Jest
  // attributes to whichever test happens to be running when it fires. That is what made
  // three offline tests fail in sequence while each passed alone.
  void result.catch(() => {});

  const settle = () =>
    result.then(
      (data) => ({ data, error: null }),
      (error: Error) => ({ data: null, error: { message: error.message } }),
    );

  const builder = {
    eq: () => builder,
    order: () => builder,
    then: (onfulfilled: unknown, onrejected: unknown) =>
      settle().then(
        onfulfilled as (v: unknown) => unknown,
        onrejected as (e: unknown) => unknown,
      ),
  };

  api.setApiTransport({ from: () => ({ select: () => builder }) } as never);
}

afterEach(() => {
  api.setApiTransport(null);
  // The stale-list cache is module state, so a test that leaves a list in it changes what
  // the next test's failure renders as. Clearing it is what keeps each case about one thing.
  clearSchoolListCache();
});

describe('SchoolPicker', () => {
  it('lists every school it is given, with its city', async () => {
    withSchools(Promise.resolve(SCHOOLS));
    await render(<SchoolPicker onSelect={() => {}} />);

    expect(await screen.findByText('Alpha Public School')).toBeTruthy();
    expect(screen.getByText('Bravo International School')).toBeTruthy();
    expect(screen.getByText('Chandra College')).toBeTruthy();
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
    // Nothing to search, so nothing that looks like searching.
    expect(screen.queryByTestId('school-picker-search')).toBeNull();
  });

  it('offers a retry when the list cannot be loaded', async () => {
    // One of the few places a retry button is honest: there is nothing cached and nothing
    // to show, because a school has not been chosen yet.
    withSchools(Promise.reject(new Error('offline')));
    await render(<SchoolPicker onSelect={() => {}} />);

    expect(await screen.findByTestId('school-picker-error')).toBeTruthy();
    expect(screen.getByText("We couldn't load the school list")).toBeTruthy();
  });

  it('recovers when a retry succeeds', async () => {
    let attempt = 0;
    const builder = {
      eq: () => builder,
      order: () => builder,
      then: (onfulfilled: unknown) => {
        attempt += 1;
        const answer =
          attempt === 1
            ? { data: null, error: { message: 'offline' } }
            : { data: SCHOOLS, error: null };
        return Promise.resolve(answer).then(onfulfilled as (v: unknown) => unknown);
      },
    };
    api.setApiTransport({ from: () => ({ select: () => builder }) } as never);

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

  describe('the welcome header (§6.1.1 cut 1)', () => {
    it('carries the value proposition that used to be a whole screen', async () => {
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} />);

      expect(
        screen.getByText('healthy, home-fresh meals delivered right to your child at school'),
      ).toBeTruthy();
      expect(
        screen.getByText('Start by picking their school. No account needed to look around.'),
      ).toBeTruthy();
    });

    it('gives a returning parent a way in', async () => {
      const onSignIn = jest.fn();
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} onSignIn={onSignIn} />);

      fireEvent.press(screen.getByTestId(SIGN_IN_TEST_ID));

      expect(onSignIn).toHaveBeenCalled();
    });

    it('hides the sign-in link when there is nowhere for it to go', async () => {
      // A link that does nothing is worse than no link, and the picker is embedded in two
      // sheets that have no sign-in route.
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} />);

      expect(screen.queryByTestId(SIGN_IN_TEST_ID)).toBeNull();
    });

    it('is left out of the embedded picker', async () => {
      // `AddChildScreen` and `ChildrenScreen` put this list inside a sheet that already has
      // its own title. A second welcome inside it would be the app introducing itself to
      // someone already signed in.
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} welcome={false} />);

      expect(await screen.findByText('Alpha Public School')).toBeTruthy();
      expect(screen.queryByTestId('school-picker-welcome')).toBeNull();
      expect(
        screen.queryByText('healthy, home-fresh meals delivered right to your child at school'),
      ).toBeNull();
    });
  });

  describe('search', () => {
    /** The field itself, not the label above it. */
    const search = () => screen.getByPlaceholderText('Search schools and colleges in Mohali');

    it('narrows the list by name', async () => {
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} />);
      await screen.findByText('Alpha Public School');

      fireEvent.changeText(search(), 'bravo');

      await waitFor(() => expect(screen.queryByText('Alpha Public School')).toBeNull());
      expect(screen.getByText('Bravo International School')).toBeTruthy();
    });

    it('narrows the list by city, because that is how half of them will start', async () => {
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} />);
      await screen.findByText('Alpha Public School');

      fireEvent.changeText(search(), 'kharar');

      await waitFor(() => expect(screen.queryByText('Alpha Public School')).toBeNull());
      expect(screen.getByText('Chandra College')).toBeTruthy();
    });

    it('says no school matches — and never that the list failed', async () => {
      // §5.21 N1 against N2. These were one state, and the collapse cost three hours of
      // hunting a data problem that did not exist.
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} />);
      await screen.findByText('Alpha Public School');

      fireEvent.changeText(search(), 'delta');

      expect(await screen.findByTestId('school-picker-no-match')).toBeTruthy();
      expect(screen.getByText('No school matches "delta"')).toBeTruthy();
      expect(screen.queryByTestId('school-picker-error')).toBeNull();
      expect(screen.queryByLabelText('Try again')).toBeNull();
    });

    it('offers the way out of an empty search', async () => {
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} />);
      await screen.findByText('Alpha Public School');

      fireEvent.changeText(search(), 'delta');
      fireEvent.press(await screen.findByLabelText('Clear search'));

      await waitFor(() => expect(screen.getByText('Alpha Public School')).toBeTruthy());
    });

    it('offers to have the school added when a caller can route it', async () => {
      const onRequestSchool = jest.fn();
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} onRequestSchool={onRequestSchool} />);
      await screen.findByText('Alpha Public School');

      fireEvent.changeText(search(), 'delta');
      fireEvent.press(await screen.findByLabelText('Ask us to add it'));

      expect(onRequestSchool).toHaveBeenCalled();
    });

    it('leaves that button out when there is nowhere to send it', async () => {
      withSchools(Promise.resolve(SCHOOLS));
      await render(<SchoolPicker onSelect={() => {}} />);
      await screen.findByText('Alpha Public School');

      fireEvent.changeText(search(), 'delta');

      await screen.findByTestId('school-picker-no-match');
      expect(screen.queryByLabelText('Ask us to add it')).toBeNull();
    });
  });

  /**
   * Coming back to a screen you have already seen, with no connection — so every one of these
   * needs a **second mount**, and a second `render()` in one test is exactly what must not be
   * written here. Two renders in a single test leave this file's renderer detached and every
   * test after it fails at its first query, which cost an hour to find. Changing the `key`
   * remounts the component through the renderer that is already attached, which is what the
   * tests actually mean anyway: the same screen, opened again.
   */
  describe('offline', () => {
    const remount = (view: { rerender: (ui: React.ReactElement) => void }, ui: React.ReactElement) =>
      view.rerender(ui);

    it('serves the last list it loaded, and says that it is old', async () => {
      // §5.21 N4: "this is what we had last time". Real, usable content — so it is not an
      // error — but never silent, because a list shown without a date is a claim it is current.
      withSchools(Promise.resolve(SCHOOLS));
      const view = await render(<SchoolPicker key="first" onSelect={() => {}} />);
      await screen.findByText('Alpha Public School');

      withSchools(Promise.reject(new Error('offline')));
      remount(view, <SchoolPicker key="second" onSelect={() => {}} />);

      expect(await screen.findByTestId('school-picker-stale')).toBeTruthy();
      expect(screen.getByText('Offline — showing the schools you last loaded.')).toBeTruthy();
      expect(screen.getByText('Alpha Public School')).toBeTruthy();
      // N4 is not N2: there is nothing to retry when the content is real.
      expect(screen.queryByTestId('school-picker-error')).toBeNull();
    });

    it('is still pickable from the cached list', async () => {
      const onSelect = jest.fn();
      withSchools(Promise.resolve(SCHOOLS));
      const view = await render(<SchoolPicker key="first" onSelect={() => {}} />);
      await screen.findByText('Alpha Public School');

      withSchools(Promise.reject(new Error('offline')));
      remount(view, <SchoolPicker key="second" onSelect={onSelect} />);
      // Wait for the stale line, not for the row: the row is on screen throughout, and
      // pressing it before the second mount has settled tests the first mount's handler.
      await screen.findByTestId('school-picker-stale');
      fireEvent.press(screen.getByTestId('school-picker-s1'));

      expect(onSelect).toHaveBeenCalledWith({
        schoolId: 's1',
        schoolName: 'Alpha Public School',
      });
    });

    it('drops the stale line once a fetch succeeds again', async () => {
      let attempt = 0;
      const builder = {
        eq: () => builder,
        order: () => builder,
        then: (onfulfilled: unknown) => {
          attempt += 1;
          const answer =
            attempt === 2
              ? { data: null, error: { message: 'offline' } }
              : { data: SCHOOLS, error: null };
          return Promise.resolve(answer).then(onfulfilled as (v: unknown) => unknown);
        },
      };
      api.setApiTransport({ from: () => ({ select: () => builder }) } as never);

      const view = await render(<SchoolPicker key="first" onSelect={() => {}} />);
      await screen.findByText('Alpha Public School');

      remount(view, <SchoolPicker key="second" onSelect={() => {}} />);
      await screen.findByTestId('school-picker-stale');

      // The connection comes back. A stale line that outlives the staleness is the same
      // class of lie as no stale line at all.
      remount(view, <SchoolPicker key="third" onSelect={() => {}} />);
      await screen.findByText('Alpha Public School');
      await waitFor(() => expect(screen.queryByTestId('school-picker-stale')).toBeNull());
    });

    it('falls back to the retry when there is no cache to serve', async () => {
      // A cold first launch on a dead connection. Nothing has ever loaded, so there is
      // genuinely nothing to show and a retry is the only honest control.
      withSchools(Promise.reject(new Error('offline')));
      await render(<SchoolPicker onSelect={() => {}} />);

      expect(await screen.findByTestId('school-picker-error')).toBeTruthy();
      expect(screen.queryByTestId('school-picker-stale')).toBeNull();
    });
  });
});
