import { SOUP_DISH_NAME, SOUP_SET_NAME } from "./orders";

export type AlacarteDish = {
  id: string;
  name: string;
  unitPrice: number;
};

export function linePrice(unitPrice: number, quantity: number): number {
  return unitPrice * quantity;
}

/** 年菜價格 choices. The old standalone 上湯魚翅羹 row is not a set. */
export function registerSetChoices<T extends { name: string }>(sets: T[]): T[] {
  return sets.filter((set) => set.name !== SOUP_SET_NAME);
}

/** 上湯魚翅羹 first, then every other dish by name. Custom dishes sort with the rest. */
export function orderAlacarteDishes<T extends { name: string }>(dishes: T[]): T[] {
  return [...dishes].sort((a, b) => {
    if (a.name === SOUP_DISH_NAME && b.name !== SOUP_DISH_NAME) return -1;
    if (b.name === SOUP_DISH_NAME && a.name !== SOUP_DISH_NAME) return 1;
    return a.name.localeCompare(b.name, "zh-Hant");
  });
}

export function addonLineText(addon: { dish_name: string; quantity?: number; price: number }): string {
  const quantity = addon.quantity && addon.quantity > 0 ? addon.quantity : 1;
  return `加購 ${addon.dish_name} ×${quantity} 售價 ${addon.price * quantity}`;
}
