export type RecentFile = {
  path: string;
  name: string;
  lastOpenedAt: number;
};

export const recentFilesStorageKey = "mindmap_recent_files_v1";
export const maxRecentFiles = 8;

export function parseRecentFiles(value: string | null): RecentFile[] {
  if (value === null) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeRecentFiles(parsed);
  } catch {
    return [];
  }
}

export function serializeRecentFiles(files: RecentFile[]): string {
  return JSON.stringify(normalizeRecentFiles(files));
}

export function rememberRecentFile(
  files: RecentFile[],
  file: Pick<RecentFile, "path" | "name">,
  now = Date.now()
): RecentFile[] {
  return normalizeRecentFiles([
    {
      path: file.path,
      name: file.name,
      lastOpenedAt: now
    },
    ...files.filter((item) => item.path !== file.path)
  ]);
}

export function removeRecentFile(files: RecentFile[], path: string): RecentFile[] {
  return normalizeRecentFiles(files.filter((file) => file.path !== path));
}

function normalizeRecentFiles(value: unknown[]): RecentFile[] {
  const byPath = new Map<string, RecentFile>();

  for (const item of value) {
    if (!isRecentFileLike(item)) {
      continue;
    }

    const path = item.path.trim();
    const name = item.name.trim();
    if (!path || !name) {
      continue;
    }

    const current = byPath.get(path);
    if (!current || item.lastOpenedAt > current.lastOpenedAt) {
      byPath.set(path, {
        path,
        name,
        lastOpenedAt: item.lastOpenedAt
      });
    }
  }

  return Array.from(byPath.values())
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, maxRecentFiles);
}

function isRecentFileLike(value: unknown): value is RecentFile {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const item = value as Partial<RecentFile>;
  return (
    typeof item.path === "string" &&
    typeof item.name === "string" &&
    typeof item.lastOpenedAt === "number" &&
    Number.isFinite(item.lastOpenedAt)
  );
}
