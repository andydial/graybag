# Proposed food types — review before applying

**Generated, not decided.** 79 unmarked dishes on production. Nothing has been written.

| | Count |
|---|---|
| Confident **veg** | 37 |
| Confident **egg** | 9 |
| **Needs you** | 33 |
| — of those, no proposal at all | 11 |

## Applying it

```bash
set -a; . ~/.graybag-secrets/prod.env; set +a
node tools/bulk-import/src/cli.mjs --dishes review/food-types.csv          # dry run
node tools/bulk-import/src/cli.mjs --dishes review/food-types.csv --apply
```

The file carries **only** `name`, `kitchen_code`, `category` and `food_type`, so applying it
can change the food type and nothing else. Rows with a blank `food_type` are left untouched —
edit those cells or leave them, either is safe.

---

## 1. Egg — 9 dishes

These name egg in the dish or its ingredients. **Check this list first**: an egg dish marked veg is
the failure that matters.

| Dish | Proposed | Why |
|---|---|---|
| Boiled Egg Mix In Brown Wheat Multigrain Sub Sandwich | `egg` | names egg |
| Boiled Eggs (3 pcs) | `egg` | names eggs |
| Chocolate Muffin | `egg` | names eggs |
| Egg Roll (Atta Wrap) | `egg` | names egg, omelette |
| Egg Sandwich | `egg` | names egg, eggs |
| French Toast with Choco Syrup | `egg` | names eggs |
| Omelette w Toast | `egg` | names egg, eggs, omelette |
| Pancakes w Honey | `egg` | names eggs |
| Scrambled Egg w Toast | `egg` | names egg, eggs |


## 2. Needs a decision — 11 dishes with no ingredient list

The name reads as vegetarian in most cases, and that is not enough. **No proposal is made**; the
`food_type` cell is blank and applying the file leaves these exactly as they are.

| Dish | Proposed | Why |
|---|---|---|
| Chole Masala With Rice /Wheat Prantha /Wheat Atta Kulcha | `—` | no ingredient list — not guessed from the name alone |
| Dal Makhni With Rice/Wheat Prantha | `—` | no ingredient list — not guessed from the name alone |
| Fried Rice With Exotic Veg | `—` | no ingredient list — not guessed from the name alone |
| Hot Choco Milk | `—` | no ingredient list — not guessed from the name alone |
| Hot Coffee | `—` | no ingredient list — not guessed from the name alone |
| Lemonade | `—` | no ingredient list — not guessed from the name alone |
| Mango Shake (Seasonal) | `—` | no ingredient list — not guessed from the name alone |
| Paneer Gravy With Rice /Wheat Prantha | `—` | no ingredient list — not guessed from the name alone |
| Rajma With Rice Or Prantha | `—` | no ingredient list — not guessed from the name alone |
| Tea | `—` | no ingredient list — not guessed from the name alone |
| Veg Manchurian With Fried Rice | `—` | no ingredient list — not guessed from the name alone |


## 3. Proposed veg, worth a glance — 22 dishes

Vegetarian on the evidence, with an ingredient that is *usually* but not *always* vegetarian.

| Dish | Proposed | Why |
|---|---|---|
| Aloo & Pea Tikki Cheese Burger (Wheat Burger) | `veg` | contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Bagels With Cream Cheese | `veg` | contains mayonnaise — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. contains mayo — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Banana Shake | `veg` | contains ice cream — some contain egg. |
| Brown Wheat Pasta With Mushroom And Pesto Cream Sauce | `veg` | contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Brown Wheat Pasta With Veg And Tomato Sauce | `veg` | contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Brownie Shake | `veg` | contains ice cream — some contain egg. |
| Cheese Garlic Bread (Maida Bread) | `veg` | contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Corn and Cheese Puff | `veg` | contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Corn And Mix Pepper Salad | `veg` | contains mayo — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. |
| Corn and Pepper Sandwich | `veg` | contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| French Butter Croissant | `veg` | contains a bread improver — these occasionally carry enzymes of animal origin. |
| Mango Shake | `veg` | contains ice cream — some contain egg. |
| Mexican Style Veg Filling Wrap (Atta Wrap) | `veg` | contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Mushroom Croissant (Maida Base) | `veg` | contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Oreo Shake | `veg` | contains ice cream — some contain egg. |
| Pain Au Chocolat | `veg` | contains a bread improver — these occasionally carry enzymes of animal origin. |
| Paneer Croissant (Maida Base) | `veg` | contains mayonnaise — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. contains mayo — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Paneer Tikka Sandwich In Focaccia Bread | `veg` | contains mayonnaise — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. contains mayo — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. |
| Strawberry Shake (Seasonal) | `veg` | contains ice cream — some contain egg. |
| Tomato, Cucumber Cheese Sandwich In Brown Bread | `veg` | contains mayonnaise — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. contains mayo — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Veg and Cheese Sandwich | `veg` | contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |
| Veg Sandwich In Brown Bread | `veg` | contains mayo — eggless mayo is standard in Indian kitchens, but egg mayo exists. Ask the kitchen. contains cheese — vegetarian rennet is usual here but is not guaranteed by the name. |


## 4. Proposed veg, confident — 37 dishes

No egg or meat in the name or the ingredient list.

| Dish | Proposed | Why |
|---|---|---|
| Aloo Channa Chat (White And Black Channa) | `veg` | no egg or meat in the name or the ingredient list |
| Banana And Honey Shake | `veg` | no egg or meat in the name or the ingredient list |
| Bhel Puri Salad | `veg` | no egg or meat in the name or the ingredient list |
| Blueberry Muffin | `veg` | no egg or meat in the name or the ingredient list |
| Brown Wheat Brownie With Choco Sauce | `veg` | no egg or meat in the name or the ingredient list |
| Butter Corn | `veg` | no egg or meat in the name or the ingredient list |
| Carrot And Raisin Cake | `veg` | no egg or meat in the name or the ingredient list |
| Chana Rice | `veg` | no egg or meat in the name or the ingredient list |
| Choco Muffin | `veg` | no egg or meat in the name or the ingredient list |
| Chocolate Doughnut | `veg` | no egg or meat in the name or the ingredient list |
| Cold Coffee | `veg` | no egg or meat in the name or the ingredient list |
| Eggless Brownie | `veg` | the dish states it is eggless |
| Fried Rice with Manchurian | `veg` | no egg or meat in the name or the ingredient list |
| Fruit Salad | `veg` | no egg or meat in the name or the ingredient list |
| Hot Chocolate Chocolate | `veg` | no egg or meat in the name or the ingredient list |
| Idli Sambar | `veg` | no egg or meat in the name or the ingredient list |
| Lemon Ice Tea | `veg` | no egg or meat in the name or the ingredient list |
| Masala Corn | `veg` | no egg or meat in the name or the ingredient list |
| Mix Veg Poha | `veg` | no egg or meat in the name or the ingredient list |
| Mixed Fruits | `veg` | no egg or meat in the name or the ingredient list |
| Paneer Jalferzi Wrap (Atta Wrap) | `veg` | no egg or meat in the name or the ingredient list |
| Paneer Puff | `veg` | no egg or meat in the name or the ingredient list |
| Paneer Sandwich | `veg` | no egg or meat in the name or the ingredient list |
| Paneer Wrap | `veg` | no egg or meat in the name or the ingredient list |
| Peach Ice Tea | `veg` | no egg or meat in the name or the ingredient list |
| Quinoa Khichdi | `veg` | no egg or meat in the name or the ingredient list |
| Quinoa Salad | `veg` | no egg or meat in the name or the ingredient list |
| Rajma Rice | `veg` | no egg or meat in the name or the ingredient list |
| Sprouts | `veg` | no egg or meat in the name or the ingredient list |
| Strawberry Shake | `veg` | no egg or meat in the name or the ingredient list |
| Stuffed Paratha | `veg` | no egg or meat in the name or the ingredient list |
| Three Beans Salad | `veg` | no egg or meat in the name or the ingredient list |
| Vada Pao (Atta Base Bread) | `veg` | no egg or meat in the name or the ingredient list |
| Veg Chilly Puff (Maida) | `veg` | no egg or meat in the name or the ingredient list |
| Veg Hot Dog | `veg` | no egg or meat in the name or the ingredient list |
| Veggie Wrap | `veg` | no egg or meat in the name or the ingredient list |
| Wheat Jaggery Cake | `veg` | no egg or meat in the name or the ingredient list |

