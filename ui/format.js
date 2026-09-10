const RAM_UNITS = ["GB", "TB", "PB", "EB", "ZB", "YB"];
const MONEY_UNITS = [
  [1e15, "q"],
  [1e12, "t"],
  [1e9, "b"],
  [1e6, "m"],
  [1e3, "k"],
];

export function formatRam(valueGb) {
  const value = Number(valueGb);
  if (!Number.isFinite(value)) return "—";

  const sign = value < 0 ? "-" : "";
  let scaled = Math.abs(value);
  let unitIndex = 0;

  while (scaled >= 1024 && unitIndex < RAM_UNITS.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }

  return `${sign}${formatCompactNumber(scaled)} ${RAM_UNITS[unitIndex]}`;
}

export function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";

  const sign = amount < 0 ? "-$" : "$";
  const absolute = Math.abs(amount);

  for (const [threshold, suffix] of MONEY_UNITS) {
    if (absolute >= threshold) {
      return `${sign}${formatCompactNumber(absolute / threshold)}${suffix}`;
    }
  }

  return `${sign}${formatCompactNumber(absolute, true)}`;
}

function formatCompactNumber(value, wholeBelowThousand = false) {
  const absolute = Math.abs(value);
  let decimals = 0;

  if (!wholeBelowThousand) {
    decimals = absolute < 10 ? 2 : absolute < 100 ? 1 : 0;
  }

  const formatted = value.toFixed(decimals);
  return formatted.replace(/\.0+$|(?<=\.[0-9])0+$/, "");
}
