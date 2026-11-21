export function remainingAmount(price: number, amountPaid: number): number {
  return price - amountPaid;
}

export function isPaidInFull(price: number, amountPaid: number): boolean {
  return amountPaid >= price;
}
