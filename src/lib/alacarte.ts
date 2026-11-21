import { SOUP_SET_NAME } from "./orders";

export type AlacarteSet = {
  price: number;
  dishes: { id: string; name: string; sort_order: number }[];
};

export type AlacarteDish = {
  id: string;
  name: string;
  unitPrice: number;
};

/** A menu set that contains only this dish is its standalone price. Otherwise the portion is 0. */
export function unitPriceForDish(dishId: string, sets: { price: number; dishIds: string[] }[]): number {
  const solos = sets.filter((set) => set.dishIds.length === 1 && set.dishIds[0] === dishId);
  if (solos.length === 0) return 0;
  return Math.min(...solos.map((set) => set.price));
}

export function linePrice(unitPrice: number, quantity: number): number {
  return unitPrice * quantity;
}

/** 年菜價格 choices. Standalone 上湯魚翅羹 is a 單點 row, not a set button. */
export function registerSetChoices<T extends { name: string }>(sets: T[]): T[] {
  return sets.filter((set) => set.name !== SOUP_SET_NAME);
}

/**
 * Every dish the kitchen already knows, once.
 * Solo dishes (such as 上湯魚翅羹) keep their set price. Set dishes with no single-item price stay at 0.
 */
export function alacarteMenu(
  dishes: { id: string; name: string }[],
  sets: AlacarteSet[],
): AlacarteDish[] {
  const priced = sets.map((set) => ({
    price: set.price,
    dishIds: set.dishes.map((dish) => dish.id),
  }));
  const byId = new Map(dishes.map((dish) => [dish.id, dish.name]));
  for (const set of sets) {
    for (const dish of set.dishes) byId.set(dish.id, dish.name);
  }

  const seen = new Set<string>();
  const ordered: { id: string; name: string }[] = [];
  const setOrder = [...sets].sort((a, b) => {
    const byPrice = b.price - a.price;
    if (byPrice !== 0) return byPrice;
    const aName = a.dishes[0]?.name ?? "";
    const bName = b.dishes[0]?.name ?? "";
    return aName.localeCompare(bName, "zh-Hant");
  });
  for (const set of setOrder) {
    const inSet = [...set.dishes].sort(
      (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-Hant"),
    );
    for (const dish of inSet) {
      if (seen.has(dish.id)) continue;
      seen.add(dish.id);
      ordered.push({ id: dish.id, name: dish.name });
    }
  }
  const extras = [...byId.entries()]
    .filter(([id]) => !seen.has(id))
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  for (const dish of extras) {
    seen.add(dish.id);
    ordered.push(dish);
  }

  return ordered.map((dish) => ({
    id: dish.id,
    name: dish.name,
    unitPrice: unitPriceForDish(dish.id, priced),
  }));
}

export function addonLineText(addon: { dish_name: string; quantity?: number; price: number }): string {
  const quantity = addon.quantity && addon.quantity > 0 ? addon.quantity : 1;
  return `加購 ${addon.dish_name} ×${quantity} 售價 ${addon.price}`;
}
