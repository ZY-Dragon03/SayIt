import { z } from "zod";

export const readerDifficultySchema = z.enum([
  "Easy",
  "Intermediate",
  "Advanced",
]);
export type ReaderDifficulty = z.infer<typeof readerDifficultySchema>;

export const readerPreferencesSchema = z
  .object({
    topics: z.array(z.string().trim().min(1).max(64)).min(1).max(12),
    dailyArticleCount: z.number().int().min(1).max(10),
    difficulty: readerDifficultySchema,
    readingBudgetMinutes: z.number().int().min(5).max(240),
    collectionTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().min(1).max(80),
  })
  .strict()
  .superRefine((preferences, context) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: preferences.timezone });
    } catch {
      context.addIssue({
        code: "custom",
        path: ["timezone"],
        message: "Choose a valid IANA time zone.",
      });
    }

    const seen = new Set<string>();
    for (const topic of preferences.topics) {
      const normalized = topic.toLocaleLowerCase("en-US");
      if (seen.has(normalized)) {
        context.addIssue({
          code: "custom",
          path: ["topics"],
          message: "Topics must not repeat.",
        });
        break;
      }
      seen.add(normalized);
    }
  });
export type ReaderPreferences = z.infer<typeof readerPreferencesSchema>;

export const issueStatusSchema = z.enum([
  "COMPLETE",
  "PARTIAL",
  "NOT_DELIVERED",
]);
export type IssueStatus = z.infer<typeof issueStatusSchema>;

export const articleContentStatusSchema = z.enum([
  "FULL_TEXT",
  "EXTERNAL_ONLY",
  "SUMMARY",
  "UNAVAILABLE",
]);
export type ArticleContentStatus = z.infer<
  typeof articleContentStatusSchema
>;

export const articleReadStateSchema = z.enum([
  "UNREAD",
  "IN_PROGRESS",
  "READ",
]);
export type ArticleReadState = z.infer<typeof articleReadStateSchema>;

export const cachePermissionSchema = z.enum([
  "PERMITTED",
  "NOT_PERMITTED",
  "UNKNOWN",
]);
export type CachePermission = z.infer<typeof cachePermissionSchema>;

export const articleSummarySchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(300),
    originalPublication: z.string().min(1).max(160),
    originalUrl: z.string().url().max(2048),
    accessiblePublication: z.string().min(1).max(160),
    accessibleUrl: z.string().url().max(2048),
    contentStatus: articleContentStatusSchema,
    wordCount: z.number().int().nonnegative(),
    fkglWordCount: z.number().int().nonnegative(),
    sentenceCount: z.number().int().nonnegative(),
    syllableCount: z.number().int().nonnegative(),
    readingMinutes: z.number().nonnegative(),
    fkgl: z.number().nullable(),
    readState: articleReadStateSchema,
    cachePermission: cachePermissionSchema,
    topics: z.array(z.string().min(1).max(64)),
    difficulty: readerDifficultySchema.nullable(),
    paragraphCount: z.number().int().nonnegative(),
  })
  .strict();
export type ArticleSummary = z.infer<typeof articleSummarySchema>;

export const occurrenceStatusSchema = z.enum([
  "WAITING",
  "RUNNING",
  "RETRY_WAIT",
  "COMPLETED",
  "ALREADY_FULFILLED",
  "EXHAUSTED",
  "MISSED",
]);
export type OccurrenceStatus = z.infer<typeof occurrenceStatusSchema>;

export const occurrenceSchema = z
  .object({
    id: z.string().min(1).max(128),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(80),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    scheduledAt: z.string().datetime({ offset: true }),
    status: occurrenceStatusSchema,
    scheduledAttemptCount: z.number().int().min(0).max(3),
    maxScheduledAttempts: z.literal(3),
    nextAttemptAt: z.string().datetime({ offset: true }).nullable(),
    lastAttemptId: z.string().nullable(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type Occurrence = z.infer<typeof occurrenceSchema>;

export const runAttemptTriggerSchema = z.enum([
  "manual",
  "scheduled",
  "catch-up",
  "regenerate",
]);
export type RunAttemptTrigger = z.infer<typeof runAttemptTriggerSchema>;

export const runAttemptStateSchema = z.enum([
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);
export type RunAttemptState = z.infer<typeof runAttemptStateSchema>;

export const runAttemptSchema = z
  .object({
    id: z.string().min(1).max(128),
    issueId: z.string().min(1).max(128),
    edition: z.number().int().min(1),
    trigger: runAttemptTriggerSchema,
    state: runAttemptStateSchema,
    startedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    retryable: z.boolean(),
    failureReason: z.string().max(500).nullable(),
    deliveredCount: z.number().int().nonnegative(),
    traceId: z.string().min(1).max(128),
  })
  .strict();
export type RunAttempt = z.infer<typeof runAttemptSchema>;

export const issueActualSchema = z
  .object({
    count: z.number().int().nonnegative(),
    topics: z.array(z.string().min(1).max(64)),
    difficulty: readerDifficultySchema.nullable(),
    readingMinutes: z.number().nonnegative(),
  })
  .strict();
export type IssueActual = z.infer<typeof issueActualSchema>;

export const dailyIssueSchema = z
  .object({
    id: z.string().min(1).max(128),
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(80),
    edition: z.number().int().min(1),
    status: issueStatusSchema,
    target: readerPreferencesSchema,
    actual: issueActualSchema,
    unmetConstraints: z.array(z.string().min(1).max(300)),
    articles: z.array(articleSummarySchema),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    priorEditions: z.array(z.number().int().min(1)),
  })
  .strict();
export type DailyIssue = z.infer<typeof dailyIssueSchema>;

export const readingProgressSchema = z
  .object({
    issueId: z.string().min(1).max(128),
    articleId: z.string().min(1).max(128),
    edition: z.number().int().min(1),
    scrollRatio: z.number().min(0).max(1),
    scrollTop: z.number().min(0).max(10_000_000),
    firstVisibleParagraph: z.number().int().min(0).max(100_000),
    paragraphOffset: z.number().min(0).max(10_000_000),
    updatedAt: z.string().datetime({ offset: true }),
    readState: articleReadStateSchema,
  })
  .strict();
export type ReadingProgress = z.infer<typeof readingProgressSchema>;

export const getPreferencesResponseSchema = z
  .object({ preferences: readerPreferencesSchema })
  .extend({ schema_version: z.literal("1") })
  .strict();
export const putPreferencesRequestSchema = z
  .object({ preferences: readerPreferencesSchema })
  .strict();
export const todayResponseSchema = z
  .object({
    issue: dailyIssueSchema.nullable(),
    occurrence: occurrenceSchema.nullable(),
    attempts: z.array(runAttemptSchema),
  })
  .extend({ schema_version: z.literal("1") })
  .strict();
export const archiveResponseSchema = z
  .object({ issues: z.array(dailyIssueSchema) })
  .extend({ schema_version: z.literal("1") })
  .strict();
export const issueEditionResponseSchema = z
  .object({ issue: dailyIssueSchema })
  .extend({ schema_version: z.literal("1") })
  .strict();

export const runRequestSchema = z
  .object({
    trigger: z.enum(["manual", "regenerate"]),
    confirmRegenerate: z.literal(true).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.trigger === "regenerate" && request.confirmRegenerate !== true) {
      context.addIssue({
        code: "custom",
        path: ["confirmRegenerate"],
        message: "Regenerate must be explicitly confirmed.",
      });
    }
    if (request.trigger === "manual" && request.confirmRegenerate === true) {
      context.addIssue({
        code: "custom",
        path: ["confirmRegenerate"],
        message: "Manual runs cannot request regeneration.",
      });
    }
  });
export type RunRequest = z.infer<typeof runRequestSchema>;

export const runResponseSchema = z
  .object({
    attempt: runAttemptSchema,
    issue: dailyIssueSchema,
  })
  .extend({ schema_version: z.literal("1") })
  .strict();
export const runStatusResponseSchema = runResponseSchema;

export const articleResponseSchema = z
  .object({
    article: articleSummarySchema,
    paragraphs: z.array(z.string().min(1)).min(1).nullable(),
    progress: readingProgressSchema.nullable(),
  })
  .extend({ schema_version: z.literal("1") })
  .strict();

export const putProgressRequestSchema = readingProgressSchema
  .omit({ updatedAt: true, readState: true })
  .strict();
export type PutProgressRequest = z.infer<typeof putProgressRequestSchema>;
export const putProgressResponseSchema = z
  .object({ progress: readingProgressSchema })
  .extend({ schema_version: z.literal("1") })
  .strict();

export const readerApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        retryable: z.boolean(),
      })
      .strict(),
  })
  .extend({ schema_version: z.literal("1") })
  .strict();
export type ReaderApiError = z.infer<typeof readerApiErrorSchema>;
