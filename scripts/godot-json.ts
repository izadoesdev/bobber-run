// ARM64 and x64 can differ by one ulp in derived sizes. Keep twelve significant
// digits for fractional values so exports stay portable; preserve integers exactly.
export function godotJson(data: unknown, indent?: number): string {
  return JSON.stringify(
    data,
    (_, value: unknown) => typeof value === 'number' && !Number.isInteger(value) ? Number(value.toPrecision(12)) : value,
    indent,
  ) + '\n';
}
