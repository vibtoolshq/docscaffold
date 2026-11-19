const HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const DEFAULT_ACCENT = "#2563eb";

export function resolveAccentColor(
  projectAccent?: string,
  siteDefault?: string,
): string {
  if (projectAccent && HEX_COLOR_PATTERN.test(projectAccent)) {
    return projectAccent;
  }
  if (siteDefault && HEX_COLOR_PATTERN.test(siteDefault)) {
    return siteDefault;
  }
  return DEFAULT_ACCENT;
}

export function getMonogram(title: string): string {
  const words = title
    .trim()
    .split(/[\s_-]+/u)
    .filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
      .join("")
      .toLocaleUpperCase();
  }

  const word = words[0] ?? "";
  const capitals = [...word].filter((character) => /\p{Lu}/u.test(character));
  if (capitals.length > 1) {
    return capitals.slice(0, 2).join("");
  }

  return word.match(/[\p{L}\p{N}]/u)?.[0]?.toLocaleUpperCase() ?? "?";
}

export function formatVersionBadge(version?: string | number | null): string {
  if (version === undefined || version === null) return "";
  const trimmed = String(version).trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/^v+/i, "").trim();
  return normalized ? `v${normalized}` : "";
}
