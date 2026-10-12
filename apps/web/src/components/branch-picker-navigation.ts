// Arrow keys wrap around the flattened local + remote list so the first and last
// branches stay one keypress apart; an empty list has no active option.
export function moveActiveIndex(current: number, delta: 1 | -1, count: number) {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return delta > 0 ? 0 : count - 1;
  return (current + delta + count) % count;
}
