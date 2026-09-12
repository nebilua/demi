export const MEMORY_CATEGORIES = [
  'preference',
  'person',
  'goal',
  'project',
  'fact',
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemorySource = {
  turnId: string;
  excerpt: string;
  createdAt: number;
};
export type ApprovedMemory = {
  id: string;
  category: MemoryCategory;
  content: string;
  source: MemorySource;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
};
export type MemoryCandidate =
  | {
      kind: 'memory';
      category: MemoryCategory;
      content: string;
      sourceExcerpt: string;
      explicit: boolean;
    }
  | {
      kind: 'important-date';
      label: string;
      eventName: string;
      date: string;
      notes: string;
      sourceExcerpt: string;
      explicit: boolean;
    };

const INSTRUCTION_PATTERN =
  /\b(ignore|disregard|override|system prompt|developer message|always obey|must follow|do not follow)\b/i;

export function normalizeMemoryContent(value: string) {
  return value.trim().replace(/\s+/g, ' ').slice(0, 240);
}

export function memoryFingerprint(value: string) {
  return normalizeMemoryContent(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function parseMemoryCandidate(
  raw: string,
  existing: ApprovedMemory[],
  sourceText?: string,
): MemoryCandidate | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const explicit = parsed.explicit === true;
    const sourceExcerpt =
      typeof parsed.sourceExcerpt === 'string'
        ? parsed.sourceExcerpt.trim().slice(0, 160)
        : '';
    if (
      sourceText &&
      sourceExcerpt &&
      !sourceText.toLocaleLowerCase().includes(sourceExcerpt.toLocaleLowerCase())
    ) {
      return null;
    }
    if (parsed.kind === 'important-date') {
      const date = typeof parsed.date === 'string' ? parsed.date : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const [year, month, day] = date.split('-').map(Number);
      const parsedDate = new Date(year, month - 1, day);
      if (
        parsedDate.getFullYear() !== year ||
        parsedDate.getMonth() !== month - 1 ||
        parsedDate.getDate() !== day
      ) {
        return null;
      }
      const label = typeof parsed.label === 'string' ? parsed.label.trim().slice(0, 80) : '';
      const eventName =
        typeof parsed.eventName === 'string'
          ? parsed.eventName.trim().slice(0, 100)
          : '';
      if (!label || !eventName || !sourceExcerpt) return null;
      return {
        kind: 'important-date',
        label,
        eventName,
        date,
        notes: typeof parsed.notes === 'string' ? parsed.notes.trim().slice(0, 500) : '',
        sourceExcerpt,
        explicit,
      };
    }
    if (
      parsed.kind !== 'memory' ||
      typeof parsed.category !== 'string' ||
      !MEMORY_CATEGORIES.includes(parsed.category as MemoryCategory) ||
      typeof parsed.content !== 'string'
    ) {
      return null;
    }
    const content = normalizeMemoryContent(parsed.content);
    if (
      content.length < 4 ||
      !sourceExcerpt ||
      INSTRUCTION_PATTERN.test(content) ||
      existing.some(
        (memory) => memoryFingerprint(memory.content) === memoryFingerprint(content),
      )
    ) {
      return null;
    }
    return {
      kind: 'memory',
      category: parsed.category as MemoryCategory,
      content,
      sourceExcerpt,
      explicit,
    };
  } catch {
    return null;
  }
}

export function selectRelevantMemories(
  memories: ApprovedMemory[],
  query: string,
  limit = 6,
) {
  const terms = new Set(
    query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2),
  );
  return memories
    .filter((memory) => !memory.archivedAt)
    .filter(
      (memory, index, all) =>
        all.findIndex(
          (candidate) =>
            memoryFingerprint(candidate.content) ===
            memoryFingerprint(memory.content),
        ) === index,
    )
    .map((memory) => ({
      memory,
      score: memory.content
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .reduce((score, term) => score + (terms.has(term) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt)
    .filter(({ score }) => score > 0)
    .slice(0, limit)
    .map(({ memory }) => memory);
}

export function parseApprovedMemories(value: string | null): ApprovedMemory[] {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('SECURE_RECORD_CORRUPT');
  const seen = new Set<string>();
  return parsed
    .filter((memory): memory is ApprovedMemory => {
      if (!memory || typeof memory !== 'object') return false;
      const item = memory as Partial<ApprovedMemory>;
      if (
        typeof item.id !== 'string' ||
        !MEMORY_CATEGORIES.includes(item.category as MemoryCategory) ||
        typeof item.content !== 'string' ||
        typeof item.createdAt !== 'number' ||
        typeof item.updatedAt !== 'number' ||
        !(item.archivedAt === null || typeof item.archivedAt === 'number') ||
        !item.source ||
        typeof item.source.turnId !== 'string' ||
        typeof item.source.excerpt !== 'string' ||
        typeof item.source.createdAt !== 'number'
      ) {
        return false;
      }
      const fingerprint = memoryFingerprint(item.content);
      if (!fingerprint || seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      return true;
    })
    .slice(0, 100);
}