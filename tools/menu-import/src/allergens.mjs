// Splitting the Excel `Allergens` column into structured tags (D7, [DM-13]).
//
// The governing rule is that an allergen present in the data but absent from the
// `allergen` table is an unwarned allergy, so this module never guesses. A fragment
// either maps to a seeded code, or it is reported — loudly, per row and in aggregate —
// and the row fails validation. Silence is the one outcome that is not allowed.

/** The twelve codes seeded in docs/data-model.md §3.3. Not yet frozen — see [DM-13]. */
export const ALLERGEN_CODES = [
  'peanut',
  'tree_nut',
  'milk',
  'egg',
  'gluten',
  'soy',
  'sesame',
  'fish',
  'crustacean',
  'mustard',
  'celery',
  'sulphite',
]

/**
 * Free-text token -> seeded code. Keys are already normalised (lower case, punctuation
 * collapsed to single spaces). Indian-kitchen vocabulary is included deliberately: a
 * menu written by the kitchen says "maida", "paneer" and "til", not "wheat flour",
 * "cheese" and "sesame".
 */
export const ALLERGEN_SYNONYMS = new Map(Object.entries({
  // peanut — kept distinct from tree_nut because the clinical allergies are distinct
  peanut: 'peanut', peanuts: 'peanut', groundnut: 'peanut', groundnuts: 'peanut',
  'ground nut': 'peanut', 'monkey nut': 'peanut', mungfali: 'peanut', moongphali: 'peanut',
  'peanut butter': 'peanut', 'peanut oil': 'peanut',

  // tree_nut
  'tree nut': 'tree_nut', 'tree nuts': 'tree_nut', 'treenut': 'tree_nut',
  nut: 'tree_nut', nuts: 'tree_nut', 'mixed nuts': 'tree_nut', 'dry fruits': 'tree_nut',
  'dry fruit': 'tree_nut', almond: 'tree_nut', almonds: 'tree_nut', badam: 'tree_nut',
  cashew: 'tree_nut', cashews: 'tree_nut', 'cashew nut': 'tree_nut', 'cashew nuts': 'tree_nut',
  kaju: 'tree_nut', walnut: 'tree_nut', walnuts: 'tree_nut', akhrot: 'tree_nut',
  pistachio: 'tree_nut', pistachios: 'tree_nut', pista: 'tree_nut',
  hazelnut: 'tree_nut', hazelnuts: 'tree_nut', pecan: 'tree_nut', pecans: 'tree_nut',
  macadamia: 'tree_nut', 'brazil nut': 'tree_nut', 'brazil nuts': 'tree_nut',
  'pine nut': 'tree_nut', 'pine nuts': 'tree_nut', chilgoza: 'tree_nut',

  // milk
  milk: 'milk', dairy: 'milk', 'milk solids': 'milk', 'milk powder': 'milk',
  'milk products': 'milk', 'condensed milk': 'milk', lactose: 'milk', casein: 'milk',
  whey: 'milk', butter: 'milk', ghee: 'milk', cheese: 'milk', 'cheese spread': 'milk',
  cream: 'milk', 'fresh cream': 'milk', curd: 'milk', dahi: 'milk',
  yoghurt: 'milk', yogurt: 'milk', paneer: 'milk', khoya: 'milk', mawa: 'milk',
  malai: 'milk', 'ice cream': 'milk', buttermilk: 'milk', chaas: 'milk',

  // egg
  egg: 'egg', eggs: 'egg', 'egg white': 'egg', 'egg whites': 'egg', 'egg yolk': 'egg',
  albumen: 'egg', albumin: 'egg', mayonnaise: 'egg', mayo: 'egg', 'egg powder': 'egg',
  anda: 'egg',

  // gluten — FSSAI declares "cereals containing gluten" as one class
  gluten: 'gluten', wheat: 'gluten', 'wheat flour': 'gluten', 'whole wheat': 'gluten',
  atta: 'gluten', maida: 'gluten', 'refined flour': 'gluten', flour: 'gluten',
  suji: 'gluten', sooji: 'gluten', semolina: 'gluten', rava: 'gluten', 'rawa': 'gluten',
  barley: 'gluten', jau: 'gluten', rye: 'gluten', spelt: 'gluten', durum: 'gluten',
  malt: 'gluten', seitan: 'gluten', bread: 'gluten', 'bread crumbs': 'gluten',
  breadcrumbs: 'gluten', pasta: 'gluten', noodles: 'gluten', 'cereals containing gluten': 'gluten',
  // Oats are gluten-free by botany and gluten-bearing by shared milling. Declared, and
  // called out in the README so the conservative reading is a visible choice.
  oat: 'gluten', oats: 'gluten',

  // soy
  soy: 'soy', soya: 'soy', soybean: 'soy', soyabean: 'soy', 'soya bean': 'soy',
  'soy bean': 'soy', 'soy sauce': 'soy', 'soya sauce': 'soy', tofu: 'soy',
  edamame: 'soy', 'soy lecithin': 'soy', 'soya chunks': 'soy',

  // sesame
  sesame: 'sesame', 'sesame seed': 'sesame', 'sesame seeds': 'sesame', til: 'sesame',
  tahini: 'sesame', gingelly: 'sesame', 'sesame oil': 'sesame',

  // fish
  fish: 'fish', anchovy: 'fish', anchovies: 'fish', tuna: 'fish', salmon: 'fish',
  'fish sauce': 'fish', pomfret: 'fish', surmai: 'fish', basa: 'fish',

  // crustacean — molluscs are deliberately NOT folded in here, see UNCODED_ALLERGENS
  crustacean: 'crustacean', crustaceans: 'crustacean', prawn: 'crustacean',
  prawns: 'crustacean', shrimp: 'crustacean', shrimps: 'crustacean', crab: 'crustacean',
  lobster: 'crustacean', crayfish: 'crustacean',

  // mustard
  mustard: 'mustard', 'mustard seed': 'mustard', 'mustard seeds': 'mustard',
  'mustard oil': 'mustard', sarson: 'mustard', rai: 'mustard', kasundi: 'mustard',

  // celery
  celery: 'celery', celeriac: 'celery',

  // sulphite
  sulphite: 'sulphite', sulphites: 'sulphite', sulfite: 'sulphite', sulfites: 'sulphite',
  'sulphur dioxide': 'sulphite', 'sulfur dioxide': 'sulphite', so2: 'sulphite',
  e220: 'sulphite', 'sulphiting agents': 'sulphite',
}))

/**
 * Recognisable allergens with no code in the seed list. Reporting these separately from
 * genuinely unknown text is the whole point: "shellfish appears 4 times and has nowhere
 * to go" is an answer to [DM-13]; "unknown token: shellfish" is not.
 */
export const UNCODED_ALLERGENS = new Map(Object.entries({
  mollusc: 'mollusc', molluscs: 'mollusc', mollusk: 'mollusc', shellfish: 'mollusc',
  squid: 'mollusc', calamari: 'mollusc', mussel: 'mollusc', mussels: 'mollusc',
  oyster: 'mollusc', oysters: 'mollusc', clam: 'mollusc', clams: 'mollusc',
  scallop: 'mollusc', scallops: 'mollusc', octopus: 'mollusc', snail: 'mollusc',
  lupin: 'lupin', lupine: 'lupin',
  // Coconut is a tree nut to the US FDA and not one to the EU or FSSAI. It will appear
  // in an Indian menu and it must not be silently resolved either way.
  coconut: 'coconut', nariyal: 'coconut', 'coconut milk': 'coconut',
  corn: 'corn', maize: 'corn', 'corn flour': 'corn', cornflour: 'corn', makai: 'corn',
  buckwheat: 'buckwheat', kuttu: 'buckwheat',
  kiwi: 'kiwi',
  mushroom: 'mushroom', mushrooms: 'mushroom',
}))

/** Whole-cell values meaning "the kitchen checked and there are none". */
// Note the omission of "x": in a spreadsheet a lone "x" far more often means "yes,
// this one" than "none", and reading it as "none" would suppress a warning.
const DECLARED_NONE = new Set([
  'none', 'nil', 'no', 'na', 'n a', 'not applicable', 'nothing', 'no allergens',
  'none known', 'no known allergens', 'allergen free', 'allergy free',
  // Normalising strips punctuation, so "-", "--" and "–" all arrive here as "".
  // An actually-empty cell is caught earlier as blank, which is a different thing.
  '',
])

/** Prefixes that describe the cell rather than name an allergen. */
const LEADING_NOISE = /^(?:allergens?|contains|contains?\s*:|declared allergens?|allergen info(?:rmation)?)\s*[:\-–]?\s*/i

const MAY_CONTAIN = /\b(?:may\s+contain|traces?\s+of|traces|possible|possibly|risk\s+of|cross[\s-]?contam\w*|prepared\s+in\s+a\s+kitchen)\b/i

/** Words to drop from a fragment before lookup — they qualify, they do not name. */
const FILLER = /\b(?:contains?|containing|and|or|with|of|the|a|an|traces?|may|might|some|products?|derivatives?|based|free|added)\b/g

export function normaliseFragment(text) {
  return text
    .toLowerCase()
    // Everything that is not a letter or a digit becomes a space, which is what makes
    // "Sesame seeds", "sesame-seeds" and "SESAME  SEEDS" the same key.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function exactLookup(key) {
  if (key === '') return null
  if (ALLERGEN_SYNONYMS.has(key)) return { kind: 'mapped', code: ALLERGEN_SYNONYMS.get(key) }
  if (UNCODED_ALLERGENS.has(key)) return { kind: 'uncoded', family: UNCODED_ALLERGENS.get(key) }
  return null
}

/**
 * Candidate keys for one fragment, in decreasing confidence. Parentheses are the common
 * case this exists for: "Egg (whole)" and "Wheat (gluten)" both name a real allergen and
 * both fail an exact match on the whole string.
 */
function candidateKeys(text) {
  const keys = []
  const push = (value) => {
    const key = normaliseFragment(value)
    if (key !== '' && !keys.includes(key)) keys.push(key)
  }

  push(text)
  // "Nuts (cashew" — an unbalanced bracket is normal once a cell has been comma-split.
  push(text.replace(/\([^)]*\)?/g, ' '))
  for (const m of text.matchAll(/\(([^)]*)\)?/g)) push(m[1])
  // Qualifiers last: "contains milk", "wheat products", "traces of peanut". Applied as
  // a fallback rather than always, so an exact synonym is never mangled on the way in.
  for (const key of [...keys]) {
    push(key.replace(FILLER, ' '))
  }
  return keys
}

function lookup(text) {
  const keys = candidateKeys(text)
  if (keys.length === 0) return { kind: 'empty', normalised: '' }
  for (const key of keys) {
    const hit = exactLookup(key)
    if (hit) return { ...hit, normalised: key }
  }
  return { kind: 'unknown', normalised: keys[0] }
}

/**
 * Split one Allergens cell into structured tags.
 *
 * Presence is sticky and left-to-right: "Contains milk, may contain peanut, tree nut"
 * reads as milk=contains, peanut=may_contain, tree_nut=may_contain, because that is how
 * a person writing the cell means it. A fragment that re-asserts "contains" switches it
 * back.
 *
 * @param {string|number|null} raw the cell value
 * @returns {{
 *   tags: Array<{code: string, presence: 'contains'|'may_contain'}>,
 *   declaredNone: boolean,
 *   blank: boolean,
 *   fragments: Array<{text: string, normalised: string, outcome: string, code?: string, family?: string, presence: string}>,
 *   unknown: string[],
 *   uncoded: Array<{text: string, family: string}>,
 *   conflicts: string[],
 * }}
 */
export function parseAllergenCell(raw) {
  const result = {
    tags: [],
    declaredNone: false,
    blank: false,
    fragments: [],
    unknown: [],
    uncoded: [],
    conflicts: [],
  }

  const text = raw == null ? '' : String(raw).trim()
  if (text === '') {
    result.blank = true
    return result
  }
  if (DECLARED_NONE.has(normaliseFragment(text))) {
    result.declaredNone = true
    return result
  }

  const body = text.replace(LEADING_NOISE, '')
  const byCode = new Map()
  let presence = 'contains'

  for (const piece of body.split(/[,;|\n\r••·]+|\s+\/\s+|\s+&\s+|\s+\band\b\s+/i)) {
    const fragment = piece.trim()
    if (fragment === '') continue

    if (MAY_CONTAIN.test(fragment)) presence = 'may_contain'
    else if (/^\s*contains\b/i.test(fragment)) presence = 'contains'

    const hit = lookup(fragment.replace(MAY_CONTAIN, ' '))
    const normalised = hit.normalised

    const record = { text: fragment, normalised, outcome: hit.kind, presence }
    if (hit.kind === 'mapped') {
      record.code = hit.code
      // "contains" beats "may_contain" when a cell names the same allergen twice.
      const existing = byCode.get(hit.code)
      if (existing && existing !== presence) {
        result.conflicts.push(hit.code)
        byCode.set(hit.code, 'contains')
      } else if (!existing) {
        byCode.set(hit.code, presence)
      }
    } else if (hit.kind === 'uncoded') {
      record.family = hit.family
      result.uncoded.push({ text: fragment, family: hit.family })
    } else if (hit.kind === 'unknown') {
      result.unknown.push(fragment)
    }
    if (hit.kind !== 'empty') result.fragments.push(record)
  }

  // Stable order so JSON output and test assertions do not depend on cell word order.
  result.tags = [...byCode.entries()]
    .map(([code, p]) => ({ code, presence: p }))
    .sort((a, b) => ALLERGEN_CODES.indexOf(a.code) - ALLERGEN_CODES.indexOf(b.code))

  return result
}
