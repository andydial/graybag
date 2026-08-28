# Store listing copy — App Store and Play Store

**Draft. Everything here is checkable against the product, and every claim is one the app
actually delivers** — a listing that promises something the app does not do is a review
rejection and, worse, a refund conversation.

## App name

| Store | Value | Limit |
|---|---|---|
| App Store | **GrayBag** | 30 chars |
| App Store subtitle | **School lunches, sorted** | 30 chars |
| Play Store title | **GrayBag: School Lunch Orders** | 30 chars |
| Play short description | **Order your child's school lunch in under a minute.** | 80 chars |

## Play Store — full description (≤4000 chars)

```
Healthy, home-fresh meals delivered right to your child at school.

GrayBag lets you order school lunches in about a minute — no queues, no cash, no forgotten
lunchboxes. Browse the day's menu, pick what your child will actually eat, and pay securely.
The kitchen cooks it fresh and delivers it to their classroom at break.

BROWSE BEFORE YOU SIGN UP
Look at your school's full menu without creating an account. Real photos, real prices, no
surprises.

ALLERGY WARNINGS THAT MEAN SOMETHING
Tell us what your child is allergic to and we'll warn you before you order — clearly, by name,
on the dish itself. If we can't check, we say so rather than leave you to assume.

MADE FOR INDIAN SCHOOLS
Pure vegetarian, contains egg, and non-vegetarian are marked on every dish. Prices in rupees.
GST shown in full at checkout, never hidden.

WHAT YOU GET
- The full menu for your child's school, with photos
- Allergy warnings based on your child's own profile
- A pickup code for every order
- Order history and invoices
- Works on a patchy connection — the menu is there even when the signal is not

HOW IT WORKS
1. Pick your school and browse the menu
2. Add what you want to the cart
3. Sign in with your email — no password to remember
4. Add your child's name and class
5. Pay, and the kitchen takes it from there

Currently serving schools in Mohali. Ask us to add yours.
```

> **Removed from the first submission, deliberately (Andy, 2026-08-10).** A "for staff and
> students too" section was drafted and cut: the *model* supports self-ordering (`P13`), but the
> "Myself / My child" screen is fast-follow, so the listing would promise a path a user cannot
> find — which is a rejection, and worse, a refund conversation. **Add it back in the same
> release that ships `E21-04`'s Myself/My child choice**, not before.

## App Store — promotional text (170 chars, editable without review)

```
Order your child's school lunch in under a minute. Real photos, clear allergy warnings, and a
pickup code for every order.
```

## App Store — description

Same body as Play, minus the ALL-CAPS headings (Apple's guidelines discourage them). Keep the
first three lines strong — they are all that shows before "more".

## Keywords (App Store, 100 chars, comma-separated, no spaces)

```
school,lunch,tiffin,meal,canteen,kids,parent,food,order,delivery,mohali,chandigarh,punjab
```

Do **not** include the word "GrayBag" — the app name is already indexed. Do not include a
competitor's name; it is a rejection.

## Screenshots — the plan

Six, in this order, because the first two are all most people see:

1. **Menu** — the two-column grid, real food, veg marks visible. *"The whole menu, before you sign up"*
2. **Dish detail with an allergen warning** — the amber block naming the allergen. *"We warn you before you order"*
3. **Cart** — the For block and the GST split. *"What you pay, in full"*
4. **Order confirmed with the pickup code** — the green pattern screen. *"A code for every order"*
5. **Orders list** — upcoming and past. *"Everything you've ordered"*
6. **Choose school** — *"Serving schools across Mohali"*

**Non-negotiable #4 applies to screenshots.** No real child's name, class or allergy may appear.
Use the prototype's fixtures — Aarav, Class 5-A, Alpha Public School — which are invented.

Sizes: 6.7" and 6.5" iPhone, 12.9" iPad if you submit for iPad; Play wants 1080x1920 minimum,
2–8 images. I can generate all six from the prototype at the right dimensions once the screens
are built — say the word.

## What's new (first release)

```
The first version of GrayBag. Browse your school's menu, order lunch for your child, and get a
pickup code. Tell us what you'd like to see next.
```

## Support and marketing URLs

**Changed 2026-08-28 (`E17-60`).** These read `graybag.in`, which was never a domain Andy owns —
it has no A record and never had one. He owns **`graybag.com`**, which resolves today and serves
the legacy Bubble pages, and which will serve the new site when he cuts it over. Both URLs move
there. Checked rather than assumed, because a store listing is not the place to discover a domain
does not answer:

```
https://graybag.com       200        A 104.19.241.93, 104.19.240.93, 104.16.36.105, 104.16.42.105
https://www.graybag.com   200 → apex
https://graybag.com/support  404      ← which is why the Support URL is NOT /support
```

- Support URL — **`https://graybag.com`**, required by both stores. **Deliberately the apex, not
  `/support`**, which 404s today. Apple rejects a Support URL that does not resolve, and a parent
  who taps Support from the App Store and lands on a 404 is worse served than one who lands on the
  home page. `E17-66` builds a real `/support` page on the new site; move this the day it ships
- Marketing URL — **`https://graybag.com`** (`E12`)
- Privacy policy URL — required, blocked on `E20-07` → `E20-21`
