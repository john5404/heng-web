export function orderTotal(
  setPrice: number,
  lines: { price: number; quantity?: number | null }[],
): number {
  return lines.reduce((sum, line) => {
    const quantity = line.quantity == null ? 1 : line.quantity;
    return sum + line.price * quantity;
  }, setPrice);
}

export function remainingAmount(price: number, amountPaid: number): number {
  return price - amountPaid;
}

export function isPaidInFull(price: number, amountPaid: number): boolean {
  return amountPaid >= price;
}
