export function maxClaims(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 4 && number <= 20 ? number : 8;
}
