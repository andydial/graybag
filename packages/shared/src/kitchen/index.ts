/**
 * Kitchen operations (`E09`). Pure aggregation over order lines — the queries that produce
 * the input belong with `E05-09`, so this is testable before a real order exists.
 */
export {
  packingCsv,
  packingList,
  perSchoolCsv,
  perSchoolTotals,
  productionCsv,
  productionTotals,
  type DishTotal,
  type KitchenOrderLine,
  type PackingEntry,
  type PackingGroup,
  type SchoolTotals,
} from './lists.js';
