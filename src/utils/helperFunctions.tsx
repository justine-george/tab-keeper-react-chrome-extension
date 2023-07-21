export function isEmptyObject(obj: any) {
  return typeof obj === "object" && Object.keys(obj).length === 0;
}
