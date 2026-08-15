import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HIGH, LOW, UNKNOWN, proposeFoodType, summarise } from '../lib/food-type.mjs';

const propose = (name, ingredientsText = 'flour, sugar', description = '') =>
  proposeFoodType({ name, ingredientsText, description });

// ------------------------------------------------------------------- the one that must not fail

test('"Eggless Brownie" is veg, and the word egg inside eggless does not trip it', () => {
  // The substring trap, and the reason every match here is word-boundaried. Getting this wrong
  // marks an explicitly eggless dish as containing egg — the harmless direction, but it would
  // destroy trust in every other row in the file.
  const r = propose('Eggless Brownie', 'Flour, cocoa powder, butter, chocolate');
  assert.equal(r.foodType, 'veg');
  assert.equal(r.confidence, HIGH);
});

test('a stated egg is egg, at high confidence', () => {
  for (const [name, ing] of [
    ['Boiled Eggs (3 pcs)', 'Eggs, salt'],
    ['Omelette w Toast', 'Eggs, onion, tomato'],
    ['French Toast with Choco Syrup', 'Bread, eggs, milk, sugar'],
  ]) {
    const r = propose(name, ing);
    assert.equal(r.foodType, 'egg', name);
    assert.equal(r.confidence, HIGH, name);
  }
});

test('egg mentioned only in the marketing copy is egg, but LOW', () => {
  // Likelier to be true than to be a typo, so it is not ignored — but the ingredient list is the
  // record, and a disagreement between the two is exactly what a human should look at.
  const r = propose('Mystery Bun', 'Flour, sugar', 'Made with farm egg.');
  assert.equal(r.foodType, 'egg');
  assert.equal(r.confidence, LOW);
});

test('meat beats everything and is high confidence', () => {
  const r = propose('Chicken Roll', 'Chicken, roti, onion');
  assert.equal(r.foodType, 'non_veg');
  assert.equal(r.confidence, HIGH);
});

test('gelatine counts as non-veg', () => {
  // Not flesh, and not vegetarian. A rule list that only knew about visible meat would pass this.
  assert.equal(propose('Fruit Jelly', 'Sugar, gelatin, fruit').foodType, 'non_veg');
});

// ----------------------------------------------------------------- refusing to answer is allowed

test('no ingredient list means NO PROPOSAL, however obvious the name', () => {
  // Nine production dishes are in this state. "Lemonade" is obviously vegetarian to a person and
  // this module still declines, because the moment it starts inferring from names it has to be
  // trusted to know that "Vada Pao" is too — and it does not.
  const r = propose('Lemonade', '');
  assert.equal(r.foodType, null);
  assert.equal(r.confidence, UNKNOWN);
  assert.match(r.why, /not guessed from the name alone/);
});

test('a null ingredient list is treated the same as an empty one', () => {
  assert.equal(proposeFoodType({ name: 'Tea', ingredientsText: null }).foodType, null);
});

test('an egg dish with no ingredient list is still egg — evidence beats absence', () => {
  // The refusal above is about *absence* of evidence. A name that says egg is evidence.
  const r = propose('Egg Roll (Atta Wrap)', '');
  assert.equal(r.foodType, 'egg');
});

// --------------------------------------------------------------------------------- the caveats

test('mayonnaise proposes veg but flags it, naming the reason', () => {
  // The judgement call that matters most in this catalogue: eggless mayo is the norm in Indian
  // kitchens and egg mayo exists. Proposing `veg` silently at high confidence would be the module
  // deciding something it is not entitled to decide.
  const r = propose('Veg Sandwich In Brown Bread', 'Capsicum, Corn, Mayo, Cheese Slice');
  assert.equal(r.foodType, 'veg');
  assert.equal(r.confidence, LOW);
  assert.match(r.why, /mayo/i);
});

test('cheese alone is enough to ask', () => {
  const r = propose('Cheese Garlic Bread', 'Mozzarella Cheese, Garlic, Butter');
  assert.equal(r.confidence, LOW);
  assert.match(r.why, /rennet/);
});

test('a plain vegetarian dish with a real ingredient list is high confidence', () => {
  const r = propose('Masala Corn', 'Steamed Corn, Chat Masala, Butter');
  assert.equal(r.foodType, 'veg');
  assert.equal(r.confidence, HIGH);
});

test('marketing copy changes nothing except by naming egg or meat', () => {
  // "wholesome", "guilt-free" and "natural" are not facts about what is in the bowl, and the
  // production descriptions are full of them. Asserted as an equality rather than as "not high":
  // the claim is that the copy is *inert*, and an earlier version of this test asserted the
  // ingredient list could not produce confidence, which is a different — and wrong — claim.
  const plain = propose('Mystery Cake', 'Maida, Sugar, Cream');
  const dressed = propose('Mystery Cake', 'Maida, Sugar, Cream', 'Wholesome, guilt-free, all natural.');
  assert.deepEqual(dressed, plain);
  assert.equal(plain.confidence, HIGH, 'a clean ingredient list is still allowed to be confident');
});

// ------------------------------------------------------------------------------------ the piles

test('the summary counts what a reviewer has to look at', () => {
  const proposals = [
    propose('A', 'corn, butter'),
    propose('B', 'mayo, corn'),
    propose('C', 'eggs'),
    propose('D', ''),
  ];
  const s = summarise(proposals);
  assert.equal(s.total, 4);
  assert.equal(s.vegHigh, 1);
  assert.equal(s.vegLow, 1);
  assert.equal(s.egg, 1);
  assert.equal(s.unknown, 1);
  // Everything that is not a confident veg or a confident egg needs a person.
  assert.equal(s.needsYou, 2);
});
