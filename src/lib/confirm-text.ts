export function confirmOrderDelete(customerName: string, when: string): string {
  return `確定刪除訂單 ${customerName}（${when}）？`;
}

export function confirmAddonDelete(dishName: string, customerName: string): string {
  return `確定刪除加購 ${dishName}（${customerName}）？`;
}

export function confirmLineRemove(dishName: string): string {
  return `確定移除單點 ${dishName}？`;
}

export function confirmSlotDelete(date: string, kind: string, label: string): string {
  return `確定刪除時段 ${date} ${kind} ${label}？`;
}
