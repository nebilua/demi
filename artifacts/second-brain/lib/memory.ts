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
      time: string | null;
      notes: string;
      sourceExcerpt: string;
      explicit: boolean;
    };

const INSTRUCTION_PATTERN =
  /\b(ignore|disregard|override|system prompt|developer message|always obey|must follow|do not follow)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

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
        time:
          typeof parsed.time === 'string' && isValidTime(parsed.time)
            ? parsed.time
            : null,
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

function isValidTime(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59;
}

function formatLocalDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate(),
  ).padStart(2, '0')}`;
}

function formatLocalTime(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(
    value.getMinutes(),
  ).padStart(2, '0')}`;
}

function parseDuration(value: string, unit: string) {
  const amount = NUMBER_WORDS[value.toLowerCase()] ?? Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const normalizedUnit = unit.toLowerCase();
  if (normalizedUnit.startsWith('minute')) return amount;
  if (normalizedUnit.startsWith('hour')) return amount * 60;
  if (normalizedUnit.startsWith('day')) return amount * 24 * 60;
  if (normalizedUnit.startsWith('week')) return amount * 7 * 24 * 60;
  return null;
}

/**
 * Converts an explicit conversational reminder into the same approved-date
 * surface used by the calendar. It intentionally handles only unambiguous
 * local phrases; ambiguous requests remain ordinary chat instead of creating
 * an unexpected notification.
 */
export function parseConversationalReminder(
  sourceText: string,
  now = new Date(),
): MemoryCandidate | null {
  const prefix = /\bremind\s+me\b/i.exec(sourceText);
  if (!prefix || prefix.index === undefined) return null;

  const body = sourceText
    .slice(prefix.index + prefix[0].length)
    .trim()
    .replace(/[.!?]+$/, '');
  if (!body) return null;

  const relative = /\b(?:in|after)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(minute|minutes|hour|hours|day|days|week|weeks)\b/i.exec(
    body,
  );
  const tomorrow = /\btomorrow\b/i.exec(body);
  const weekday = /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(
    body,
  );
  const isoDate = /\bon\s+(\d{4}-\d{2}-\d{2})\b/i.exec(body);
  const timingMatch = relative ?? tomorrow ?? weekday ?? isoDate;
  if (!timingMatch) return null;

  let target = new Date(now);
  let includeTime = true;
  if (relative) {
    const minutes = parseDuration(relative[1], relative[2]);
    if (!minutes) return null;
    target.setSeconds(0, 0);
    target.setMinutes(target.getMinutes() + minutes);
    includeTime = true;
  } else if (tomorrow) {
    target.setDate(target.getDate() + 1);
  } else if (weekday) {
    const targetDay = WEEKDAYS.indexOf(weekday[1].toLowerCase());
    const daysAhead = (targetDay - target.getDay() + 7) % 7 || 7;
    target.setDate(target.getDate() + daysAhead);
  } else if (isoDate) {
    const [year, month, day] = isoDate[1].split('-').map(Number);
    target = new Date(year, month - 1, day, 9, 0, 0, 0);
    if (
      target.getFullYear() !== year ||
      target.getMonth() !== month - 1 ||
      target.getDate() !== day
    ) {
      return null;
    }
  }

  const eventName = body
    .replace(timingMatch[0], ' ')
    .replace(/^\s*(to|about|of)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!eventName) return null;

  return {
    kind: 'important-date',
    label: 'Reminder',
    eventName: eventName.slice(0, 100),
    date: formatLocalDate(target),
    time: includeTime ? formatLocalTime(target) : null,
    notes: '',
    sourceExcerpt: sourceText.trim().slice(0, 160),
    explicit: true,
  };
}

export function selectRelevantMemories(
  memories: ApprovedMemory[],
  query: string,
  limit = 6,
  conversationContext = '',
) {
  const terms = new Set(
    `${query}\n${conversationContext}`
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length > 2),
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