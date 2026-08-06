# GrayBag — Bubble Export: Schema & Privacy Map (as-is)

Source: `gray-bag-23660.bubble` (app definition export, not data rows). App id `graybag23660`, domain `graybag.com`, private app, Workflow API exposed.

---

## 1. Data types (16; 2 effectively dead)

### Core commerce
| Type | Fields (live) | Notes |
|---|---|---|
| **User** | fname, lname, mobile (number), disabled (bool), school → School, Role → option user_role, child → list of Child, Stripe_id, current_client_secret | Single flat user table. `current_client_secret` stored on user = bad. Mobile as number loses leading zeros/+91. |
| **Child** | first_name, last_name, class (text), section (text), allergies, school → School, school-code (text), parent-email (text), Parent → **list of User** | Two parallel parent links: `Parent` list **and** `Guardian_Link`. Redundant. `school-code`/`parent-email` are denormalised string copies. |
| **Guardian_Link** | user → User, child → Child, role (text), relationship (text), can_order (bool), is_primary (bool) | The "proper" join table — appears half-adopted. `role`/`relationship` are free text, not options. |
| **School** | name, address, City (option), isCollege (bool), contact-email, kitchen → Kitchen, menu → Menu | `isCollege` is the only school/uni distinction. |
| **Kitchen** | name, address, city (option), owner-email (text), is_active, default_menu → Menu | Kitchen staff identity = an email string, not a user relation. |
| **Break-Timings** | School → School, break-time (option), break_start (text), break_end (text), break-id (number) | Times stored as **text**, not time. |

### Menu
| Type | Fields | Notes |
|---|---|---|
| **Dish** | name, photo, description, Ingredients, Calorie Count (text), nutritional_info, Category (option) | Price removed from Dish (good) — now on Menu_Item. |
| **Menu** | name, version (number), status (option: draft/active/retired), active_from, active_to, kitchen → Kitchen, is_default_for_kitchen | Versioning already exists — useful for the caching idea. |
| **Menu_Item** | dish → Dish, menu → Menu, price, category (option), is_active, available_days (list of DayOfWeek) | Correct price-per-menu join. |
| **School_Menu** | school → School, menu → Menu, start_date, end_date, is_current | Third overlapping path school→menu (School.menu, Kitchen.default_menu, School_Menu). Ambiguous source of truth. |

### Orders
| Type | Fields | Notes |
|---|---|---|
| **Order** | order_date, order_ymd (text), order_week/month/year (numbers), status (option order_status0), actor_user → User, order-parent → User, staff_user → User, child → Child, recipient_type (option), school, kitchen, menu, city, break (option), order-total, payment_id **and** payment-id (two live text fields), cancel-reason, all-dishes-in-order → list of Dish_In_Order | **Three** user pointers + duplicated payment id fields + pre-computed date parts (denormalised for Bubble's weak querying). |
| **Dish_In_Order** | dish → Dish, order → Order, child → Child, school → School, quantity, unit_price, line_total, order_date, special-comments | Line item. Snapshots unit_price (good). Does not snapshot dish name/photo — menu edits rewrite order history. |
| **Temp** | link_id, payment_id, signature | Razorpay callback scratch table. Unbounded growth, holds payment signatures. |

### Marketing / dead
- **investor_submission** — name, email, phone, city, level_of_interest, timeframe, risk-concern, contact_accepted
- **Interest_Submission** (`findoutmoresubmission`) — name, email, phone, city, school, message, reason_to_use, most_important_thing
- **Image-Files** — deleted.

---

## 2. Option sets

| Set | Values (display → db value) |
|---|---|
| **User-Role** | Parent→`parent`, SuperAdmin→`admin`, KitchenStaff→`kitchen`, CollegeStudent→`collegestudent`, Report_SchoolAdmin→`staff`, School Staff→`teacher` |
| **Order_Status** | Draft→`new`, Paid→`received`, Preparing→`accepted`, Delivered→`delivered`, Cancelled→`cancelled`, Refunded→`refunded` |
| **Recipient_Type** | Child, Class, Staff (Teacher deleted) |
| **Cities** | Chandigarh, SAS Nagar (Mohali), Panchkula |
| **Categories** | Breakfast, Bakery, Sandwich, Salads, Continental, Quick Bites, Meals, Drinks, All (+5 deleted) — each with a CDN image |
| **Menu_Status** | draft, active, retired |
| **DayOfWeek** | Mon–Sat (has `day_number` attr) — named `unavailable_days`, used as *available* days |
| **Break-Start-Times** | `10__00_am` → "10:40AM - 11:15AM", `10_15_am` → "11:15AM - 11:40AM" (+3 deleted) — **db values contradict labels** |
| **Guardian_Relationship** | Father→`parent`, Mother→`mother`, Guardian, Teacher, Parent→`parent0`, Carer |
| **Order-Status**, **School_Menu**, **Break-Duration** | empty / unused |

Note the role-value drift: `staff` = school admin, `teacher` = school staff, `collegestudent` = uni student. Any migration must map on **db_value**, not label.

---

## 3. Privacy rules (Bubble) — only 5 of 16 types have any

| Type | Rule | Effective exposure |
|---|---|---|
| **User** | everyone: no access. Admin (Role=admin): full. Own record: view + attachments | Reasonable. |
| **Order** | **everyone: view_all = true, search_for = true** | **Any visitor can search and read every order** — child name, school, break time, total, parent. |
| **Break-Timings** | everyone: view_all + search_for = true; admin: edit | Low sensitivity. |
| **investor_submission** | Creator only; everyone denied | Correct. |
| **Interest_Submission** | everyone: create only; creator: full | Correct. |
| **Child, Guardian_Link, Dish_In_Order, School, Kitchen, Menu, Menu_Item, Dish, School_Menu, Temp** | **no rules defined** | Bubble default = fully readable/searchable by everyone. `Child` includes **allergies, name, class, section, school, parent email** of minors. `Temp` includes payment signatures. |

This is the single biggest issue in the current system, and it does not migrate — a new backend has to enforce authorisation server-side from day one.

---

## 4. Payments (as built)

- **Razorpay**: `POST /v1/payment_links` (hosted payment link, amount hardcoded 5000 in the call template, `expire_by` a fixed epoch) and `POST /v1/payments/{id}/refund`. Auth = a single shared private header.
- **Stripe** also wired: create customer, create setup_intent; `stripe-add-card`, `make_payment`, `payment_completed` pages; `User.Stripe_id`, `User.current_client_secret`. Two payment stacks coexist.
- **Backend workflow `payment_processed`** — public endpoint, params `order_unique_id`, `status`, `signature`. Sets Order.status = `received`, emails the kitchen owner. Signature verification is not visible as a server-side HMAC check.
- Payment-link redirect flow (leave app → hosted page → return) is what makes UPI feel clunky; native UPI intent / Razorpay checkout SDK is the fix.

---

## 5. Backend workflows (4)

| Name | Exposed | Purpose |
|---|---|---|
| `payment_processed` | public | mark order paid, email kitchen |
| `send_reset_email` | no | password reset |
| `add_child_school` | no | backfill Child.school when empty |
| `update_empty_school` | public | sets a user's school to a **hardcoded school id** `1749446685836x657725915595526160` |

---

## 6. Front end (migration effort sizing)

19 web pages + 13 mobile views, **147 workflows / 306 actions** total.

- **Web pages**: index, old_index, menu, signin, dashboard, report-totalorders, checkout-cart-web, make_payment, payment_completed, stripe-add-card, temp, delete-user, find_out_more, investor_submission, submitted-thank-you, privacy-policy, refund-policy, reset_pw, 404
- **Mobile views**: Home, Home - Trial (duplicate, 15 wfs), Cart, Login, Sign Up, Profile, Reset_Pwd, reset_password (duplicate), T&Cs, update_app, Web-Checout-Cart, Add-Update-Card, loading-shared
- Heaviest: `menu` (23 wf), Home (16), Profile (16), Home - Trial (15), index (13)
- Plugins: Ionic, select2, Material Icons, API Connector, Chart.js, + 4 marketplace plugins.

---

## 7. SECURITY — act before anything else

This export file contains **live secrets in cleartext** under `settings.secure`:

- a **live Razorpay key** (`rzp_live…`) and Razorpay test keys
- Stripe **test** secret key (`sk_test…`) in the API Connector auth header
- 2 marketplace plugin app secrets (live + test)

Rotate the Razorpay live key and the plugin secrets, and treat this `.bubble` file as a secret (do not commit it to GitHub).
