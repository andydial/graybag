// A SYNTHETIC menu sheet in the documented shape.
//
// It is not GrayBag data. The real "GrayBag_School_Menu 1 1.xlsx" is not in this
// repository (see README §"The source file is missing"), so this exists to (a) let the
// tests run hermetically and (b) let a human see the tool's output before the real file
// turns up. Dish names, prices and allergens are invented.
//
// It deliberately contains one of each failure the validator is meant to catch, so the
// demo output doubles as a catalogue of what the report looks like when things go wrong.

export const HEADER = [
  'Item No.',
  'Menu Item',
  'Description',
  'Ingredients',
  'Calories',
  'Portion/Weight',
  'Allergens',
  'Category',
  'Category - ORIG',
  'Price',
]

export const SAMPLE_ROWS = [
  // A title row above the header — extremely common, and the reason headers are found
  // by scanning rather than assumed to be row 1.
  ['GrayBag School Menu — Term 1', null, null, null, null, null, null, null, null, null],
  [],
  HEADER,

  // --- rows that should pass ---
  [1, 'Veg Sandwich', 'Grilled sandwich', 'Bread, butter, vegetables', '320', '180 g', 'Gluten, Milk', 'Sandwich', 'sandwich_old', 60],
  [2, 'Paneer Wrap', 'Wholewheat wrap', 'Atta, paneer, onion', 410, '220 g', 'Contains gluten, milk', 'Meals', 'meals_old', 95],
  [3, 'Cold Coffee', 'Chilled coffee', 'Milk, coffee, sugar', '210', '250 ml', 'Milk', 'Drinks', 'drinks_old', 75.5],
  [4, 'Fruit Bowl', 'Seasonal fruit', 'Assorted fruit', '150', '200 g', 'None', 'Quick Bites', 'qb_old', 55],
  [5, 'Aloo Paratha', 'Stuffed paratha', 'Atta, potato, ghee', '480', '2 pcs', 'Gluten, Milk, may contain traces of peanut', 'Breakfast', 'bf_old', 70],
  [6, 'Chocolate Muffin', 'Baked fresh', 'Maida, egg, cocoa', '390', '90 g', 'Gluten, Egg, Milk, Soy', 'Bakery', 'bakery_old', 45],
  [7, 'Garden Salad', 'Mixed greens', 'Lettuce, cucumber, dressing', '120', '150 g', 'Mustard', 'Salads', 'salad_old', 80],
  [8, 'Pasta Alfredo', 'Creamy pasta', 'Pasta, cream, cheese', '520', '250 g', 'Gluten, Milk', 'Continental', 'cont_old', 110],

  // --- rows that should fail, one failure mode each ---
  [9, 'Missing Price Dish', 'No price given', 'Something', '200', '100 g', 'None', 'Meals', null, null],
  [10, null, 'A row with no name', 'Something', '200', '100 g', 'None', 'Meals', null, 50],
  [11, 'Odd Price Dish', 'Price is text', 'Something', '200', '100 g', 'None', 'Meals', null, 'ask counter'],
  [12, 'Free Dish', 'Zero price', 'Something', '200', '100 g', 'None', 'Meals', null, 0],
  [13, 'Mystery Category Dish', 'Category not seeded', 'Something', '200', '100 g', 'None', 'Tiffin', null, 65],
  [14, 'Everything Dish', 'Category is the browse affordance', 'Something', '200', '100 g', 'None', 'All', null, 65],
  [15, 'Prawn Toast', 'Uncoded allergen', 'Prawn, bread', '300', '120 g', 'Gluten, Shellfish', 'Continental', null, 130],
  [16, 'Chef Special', 'Unreadable allergen text', 'Varies', '300', '120 g', 'Ask the chef', 'Meals', null, 120],
  [17, 'Veg Sandwich', 'A duplicate name', 'Bread, butter', '320', '180 g', 'Gluten', 'Sandwich', null, 60],
  [18, 'Sub Paisa Dish', 'Price is not whole paise', 'Something', '200', '100 g', 'None', 'Meals', null, '65.005'],

  // --- rows that pass but warn ---
  [19, 'Blank Allergen Dish', 'Allergen cell left empty', 'Something', '200', '100 g', null, 'Meals', null, 85],
  [20, 'Range Calorie Dish', 'Calories given as a range', 'Something', '300-400', '100 g', 'None', 'Meals', null, 90],
  [21, 'Unknown Calorie Dish', 'Calories not a number', 'Something', 'approx', '100 g', 'None', 'Meals', null, 90],

  // A blank separator row and a section heading typed into the name column.
  [],
  [null, 'Drinks', null, null, null, null, null, null, null, null],
]
