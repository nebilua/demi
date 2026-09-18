import { MAX_MEMORIES } from './localLimits';

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
  aliases?: string[];
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

const RETRIEVAL_STOP_WORDS = new Set([
  'a',
  'about',
  'after',
  'and',
  'are',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'should',
  'someone',
  'that',
  'the',
  'their',
  'them',
  'they',
  'this',
  'to',
  'user',
  'was',
  'what',
  'which',
  'with',
  'would',
  'you',
  'your',
]);

const RETRIEVAL_ALIASES: Record<string, string> = {
  buy: 'gift',
  buying: 'gift',
  choose: 'gift',
  choosing: 'gift',
  gift: 'gift',
  gifting: 'gift',
  gifts: 'gift',
  idea: 'gift',
  ideas: 'gift',
  pick: 'gift',
  picking: 'gift',
  present: 'gift',
  presents: 'gift',
  purchase: 'gift',
  purchases: 'gift',
  recommend: 'gift',
  recommendation: 'gift',
  recommendations: 'gift',
  suggest: 'gift',
  suggestion: 'gift',
  suggestions: 'gift',
  enjoy: 'preference',
  enjoys: 'preference',
  favorite: 'preference',
  favourites: 'preference',
  favourite: 'preference',
  favorites: 'preference',
  interests: 'preference',
  interest: 'preference',
  like: 'preference',
  love: 'preference',
  prefer: 'preference',
  preference: 'preference',
  preferences: 'preference',
  taste: 'preference',
  tastes: 'preference',
};

export const MAX_MEMORY_ALIASES = 8;
export const MAX_MEMORY_ALIAS_CHARS = 48;

const CONTEXT_BRIDGE_PATTERN =
  /\b(buy|choose|gift|idea|present|recommend|suggest|that|their|them|they|those|it)\b/i;

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

export function normalizeMemoryAliases(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const alias = item.trim().replace(/\s+/g, ' ').slice(0, MAX_MEMORY_ALIAS_CHARS);
    const fingerprint = memoryFingerprint(alias);
    if (!fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    aliases.push(alias);
    if (aliases.length >= MAX_MEMORY_ALIASES) break;
  }
  return aliases;
}

export function getConflictingMemoryAliasKeys(
  memories: ApprovedMemory[],
): Set<string> {
  const ownersByAlias = new Map<string, Set<string>>();
  for (const memory of memories) {
    if (memory.archivedAt) continue;
    for (const alias of normalizeMemoryAliases(memory.aliases)) {
      const key = memoryFingerprint(alias);
      const owners = ownersByAlias.get(key) ?? new Set<string>();
      owners.add(memory.id);
      ownersByAlias.set(key, owners);
    }
  }
  return new Set(
    [...ownersByAlias]
      .filter(([, owners]) => owners.size > 1)
      .map(([key]) => key),
  );
}

export function getConflictingMemoryOwners(
  memories: ApprovedMemory[],
  memoryId: string,
  alias: string,
): ApprovedMemory[] {
  const aliasKey = memoryFingerprint(alias);
  if (!aliasKey) return [];

  const owner = memories.find((memory) => memory.id === memoryId);
  if (!owner || owner.archivedAt) return [];

  return memories.filter(
    (memory) =>
      memory.id !== memoryId &&
      !memory.archivedAt &&
      normalizeMemoryAliases(memory.aliases).some(
        (candidate) => memoryFingerprint(candidate) === aliasKey,
      ),
  );
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

type RetrievalTerm = {
  raw: string;
  canonical: string;
  aliasKey?: string;
};

function retrievalTerms(value: string, aliasKey?: string): RetrievalTerm[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((term) => {
      if (term.length > 4 && term.endsWith('ies')) {
        return `${term.slice(0, -3)}y`;
      }
      if (term.length > 4 && term.endsWith('s') && !term.endsWith('ss')) {
        return term.slice(0, -1);
      }
      return term;
    })
    .filter((term) => term.length > 0 && !RETRIEVAL_STOP_WORDS.has(term))
    .map((term) => ({
      raw: term,
      canonical: RETRIEVAL_ALIASES[term] ?? term,
      aliasKey,
    }));
}

function memoryRetrievalTerms(memory: ApprovedMemory): RetrievalTerm[] {
  return [
    ...retrievalTerms(memory.content),
    ...normalizeMemoryAliases(memory.aliases).flatMap((alias) =>
      retrievalTerms(alias, memoryFingerprint(alias)),
    ),
  ];
}

function parseClockTime(sourceText: string) {
  const match =
    /\bat\s+(\d{1,2}(?::\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?\b/i.exec(sourceText);
  if (!match) return null;

  const [hourText, minuteText = '00'] = match[1].split(':');
  const rawHour = Number(hourText);
  const minute = Number(minuteText);
  const meridiem = match[2]?.replace(/\./g, '').toLowerCase();
  if (!Number.isInteger(rawHour) || !Number.isInteger(minute) || minute > 59) {
    return { invalid: true as const };
  }

  let hour = rawHour;
  if (meridiem) {
    if (hour < 1 || hour > 12) return { invalid: true as const };
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (!match[1].includes(':') || hour > 23) {
    return { invalid: true as const };
  }

  const trailingMeridiem = /^\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(
    sourceText.slice(match.index + match[0].length),
  );
  if (trailingMeridiem) return { invalid: true as const };

  return {
    match,
    minutes: hour * 60 + minute,
  };
}

export function hasConversationalReminderIntent(sourceText: string) {
  return /\bremind\s+me\b/i.test(sourceText);
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
  const clockTime = parseClockTime(body);
  if (clockTime?.invalid) return null;
  if (!relative && !tomorrow && !weekday && !isoDate) return null;

  let target = new Date(now);
  if (relative) {
    const minutes = parseDuration(relative[1], relative[2]);
    if (!minutes) return null;
    target.setSeconds(0, 0);
    target.setMinutes(target.getMinutes() + minutes);
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
  if (clockTime) {
    target.setHours(
      Math.floor(clockTime.minutes / 60),
      clockTime.minutes % 60,
      0,
      0,
    );
  }

  const timingMatches = [relative, tomorrow, weekday, isoDate, clockTime?.match].filter(
    (match): match is RegExpExecArray => Boolean(match),
  );
  const eventName = timingMatches
    .reduce((value, match) => value.replace(match[0], ' '), body)
    .replace(/^\s*(to|about|of)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!eventName) return null;

  return {
    kind: 'important-date',
    label: 'Reminder',
    eventName: eventName.slice(0, 100),
    date: formatLocalDate(target),
    time: formatLocalTime(target),
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
  const queryTerms = retrievalTerms(query);
  const queryRawTerms = new Set(queryTerms.map(({ raw }) => raw));
  const queryCanonicalTerms = new Set(queryTerms.map(({ canonical }) => canonical));
  const contextTerms = retrievalTerms(conversationContext);
  const contextRawTerms = new Set(contextTerms.map(({ raw }) => raw));
  const contextCanonicalTerms = new Set(
    contextTerms.map(({ canonical }) => canonical),
  );
  const allowContextBridge = CONTEXT_BRIDGE_PATTERN.test(query);
  const activeMemories = memories
    .filter((memory) => !memory.archivedAt)
    .filter(
      (memory, index, all) =>
        all.findIndex(
          (candidate) =>
            memoryFingerprint(candidate.content) ===
            memoryFingerprint(memory.content),
        ) === index,
    )
    .map((memory) => ({ memory, terms: memoryRetrievalTerms(memory) }));
  const ambiguousAliasKeys = getConflictingMemoryAliasKeys(
    activeMemories.map(({ memory }) => memory),
  );
  const documentFrequency = new Map<string, number>();
  for (const { terms } of activeMemories) {
    for (const term of terms) {
      documentFrequency.set(
        term.canonical,
        (documentFrequency.get(term.canonical) ?? 0) + 1,
      );
    }
  }

  return activeMemories
    .map(({ memory, terms }) => ({
      memory,
      score: terms.reduce((score, term) => {
        if (term.aliasKey) {
          if (ambiguousAliasKeys.has(term.aliasKey)) return score;
          if (queryRawTerms.has(term.raw)) return score + 1.5;
          if (allowContextBridge && contextRawTerms.has(term.raw)) return score + 0.45;
          return score;
        }
        if (queryRawTerms.has(term.raw)) {
          const isRare = documentFrequency.get(term.canonical) === 1;
          return score + (term.raw.length <= 2 || isRare ? 1.5 : 0.9);
        }
        if (queryCanonicalTerms.has(term.canonical)) {
          return score + 0.3;
        }
        if (allowContextBridge && contextRawTerms.has(term.raw)) {
          return score + 0.45;
        }
        if (allowContextBridge && contextCanonicalTerms.has(term.canonical)) {
          return score + 0.15;
        }
        return score;
      }, 0),
    }))
    .sort((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt)
    .filter(({ score }) => score >= 1.25)
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
        (item.aliases !== undefined && !Array.isArray(item.aliases)) ||
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
    .map((memory) => ({
      ...memory,
      aliases: normalizeMemoryAliases(memory.aliases),
    }))
    .slice(0, MAX_MEMORIES);
}