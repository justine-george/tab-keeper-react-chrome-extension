export function isEmptyObject(obj: any): boolean {
  return typeof obj === "object" && Object.keys(obj).length === 0;
}

export function getCurrentDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  // Month is 0-indexed, so +1
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

// returns true if lottery is won, else false
export function isLotteryWon(): boolean {
  const number = Math.floor(Math.random() * 2); // this could be 0 or 1
  return number === 1;
}

// simulate network delay for testing
export function simulateNetworkDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
