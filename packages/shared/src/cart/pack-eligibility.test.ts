import { describe, expect, it } from 'vitest';

import { checkPackMeal, packMealMessage } from './pack-eligibility.js';

/**
 * `E21-40`. The app's copy of the meal rule, tested against the shape the server enforces.
 *
 * The point of this file is not that the rule is right — the server decides that — but that the
 * app's answer **agrees** with it. Where they disagree a parent is told a cart qualifies and then
 * refused at confirm time, or told it does not and never tries.
 */

const RULE = { itemsPerMeal: 2, requiredCategoryId: 'cat-drinks' };
const drink = (quantity = 1) => ({ categoryId: 'cat-drinks', quantity });
const food = (quantity = 1) => ({ categoryId: 'cat-mains', quantity });

describe('checkPackMeal', () => {
  it('accepts exactly the rule: two items, one from the required category', () => {
    expect(checkPackMeal([food(), drink()], RULE)).toBeNull();
  });

  it('counts QUANTITY, not rows — two of one dish is two items', () => {
    // The server sums `order_line.quantity`. Counting rows here would pass a cart of one dish
    // times two that the server then refuses, which is the disagreement this module exists to
    // prevent. Two drinks are two items and satisfy the category, so this is a valid meal.
    expect(checkPackMeal([drink(2)], RULE)).toBeNull();
  });

  it('refuses two of a non-required dish, even though the count is right', () => {
    expect(checkPackMeal([food(2)], RULE)).toEqual({ reason: 'missing_required_category' });
  });

  it('says how far short, so the copy can be specific', () => {
    expect(checkPackMeal([drink()], RULE)).toEqual({ reason: 'too_few', shortBy: 1 });
    expect(checkPackMeal([], RULE)).toEqual({ reason: 'nothing_chosen' });
  });

  it('says how far over', () => {
    expect(checkPackMeal([food(), food(), drink()], RULE)).toEqual({
      reason: 'too_many',
      overBy: 1,
    });
  });

  it('reads the count from the OFFER, never assuming two', () => {
    // `items_per_meal` is configurable. A rule hardcoded to two would silently mis-advise every
    // parent the day a three-item pack is created.
    const three = { itemsPerMeal: 3, requiredCategoryId: 'cat-drinks' };
    expect(checkPackMeal([food(), food(), drink()], three)).toBeNull();
    expect(checkPackMeal([food(), drink()], three)).toEqual({ reason: 'too_few', shortBy: 1 });
  });

  it('reads the category from the OFFER, never assuming Drinks', () => {
    const fruitRule = { itemsPerMeal: 2, requiredCategoryId: 'cat-fruit' };
    expect(checkPackMeal([food(), drink()], fruitRule)).toEqual({
      reason: 'missing_required_category',
    });
    expect(
      checkPackMeal([food(), { categoryId: 'cat-fruit', quantity: 1 }], fruitRule),
    ).toBeNull();
  });

  it('ignores a zero-quantity line when checking the category', () => {
    // A removed line can linger at quantity 0. It must not satisfy the drink requirement, or a
    // parent is told their cart qualifies on the strength of something that is not in it.
    expect(checkPackMeal([food(2), { categoryId: 'cat-drinks', quantity: 0 }], RULE)).toEqual({
      reason: 'missing_required_category',
    });
  });
});

describe('packMealMessage', () => {
  it('says nothing when there is nothing wrong', () => {
    expect(packMealMessage(null, 'a drink')).toBeNull();
  });

  it('names the required category in the parent’s words', () => {
    expect(packMealMessage({ reason: 'missing_required_category' }, 'a drink')).toBe(
      'One of the two must be a drink',
    );
    // The label is passed in, so a pack requiring fruit says fruit.
    expect(packMealMessage({ reason: 'missing_required_category' }, 'a piece of fruit')).toBe(
      'One of the two must be a piece of fruit',
    );
  });

  it('is specific about how many, singular and plural', () => {
    expect(packMealMessage({ reason: 'too_few', shortBy: 1 }, 'a drink')).toBe('Pick one more item');
    expect(packMealMessage({ reason: 'too_few', shortBy: 2 }, 'a drink')).toBe('Pick 2 more items');
    expect(packMealMessage({ reason: 'too_many', overBy: 1 }, 'a drink')).toMatch(/remove one/);
    expect(packMealMessage({ reason: 'too_many', overBy: 3 }, 'a drink')).toMatch(/remove 3/);
  });

  it('has copy for every problem the checker can produce', () => {
    // A reason code with no sentence renders as silence, which leaves a parent staring at a
    // control that will not turn on. This walks every branch the checker can return.
    const problems = [
      checkPackMeal([], RULE),
      checkPackMeal([drink()], RULE),
      checkPackMeal([food(), food(), drink()], RULE),
      checkPackMeal([food(2)], RULE),
    ];
    for (const problem of problems) {
      expect(packMealMessage(problem, 'a drink')).toBeTruthy();
    }
  });
});
