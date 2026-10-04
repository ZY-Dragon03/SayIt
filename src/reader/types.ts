export type ReaderDifficulty = "Easy" | "Intermediate" | "Advanced";
export type ReaderIssueStatus = "COMPLETE" | "PARTIAL" | "NOT_DELIVERED";
export type ReaderContentStatus =
  | "FULL_TEXT"
  | "EXTERNAL_ONLY"
  | "SUMMARY"
  | "UNAVAILABLE";

export interface ReaderPreferences {
  topics: string[];
  dailyArticleCount: number;
  difficulty: ReaderDifficulty;
  readingBudgetMinutes: number;
  collectionTime: string;
  timezone: string;
}

export type ReaderIssueTarget = ReaderPreferences;

export interface ReaderIssueActual {
  count: number;
  topics: string[];
  difficulty: ReaderDifficulty;
  readingMinutes: number;
}

export interface ReaderArticleSummary {
  id: string;
  title: string;
  originalPublication: string;
  originalUrl: string;
  accessiblePublication: string;
  accessibleUrl: string;
  contentStatus: ReaderContentStatus;
  wordCount: number;
  fkglWordCount: number;
  sentenceCount: number;
  syllableCount: number;
  readingMinutes: number;
  fkgl: number;
  readState: string;
  cachePermission: "PERMITTED" | "NOT_PERMITTED" | "UNKNOWN";
  topics: string[];
  difficulty: ReaderDifficulty;
  paragraphCount: number;
}

export interface PriorEditionSummary {
  edition: number;
}

export interface DailyIssue {
  id: string;
  localDate: string;
  timezone: string;
  edition: number;
  status: ReaderIssueStatus;
  target: ReaderIssueTarget;
  actual: ReaderIssueActual;
  unmetConstraints: string[];
  articles: ReaderArticleSummary[];
  createdAt?: string;
  updatedAt?: string;
  priorEditions: number[];
}

export interface Occurrence {
  id: string;
  localDate: string;
  timezone: string;
  localTime: string;
  scheduledAt: string;
  status:
    | "WAITING"
    | "RUNNING"
    | "RETRY_WAIT"
    | "COMPLETED"
    | "ALREADY_FULFILLED"
    | "EXHAUSTED"
    | "MISSED";
  scheduledAttemptCount: number;
  maxScheduledAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptId: string | null;
  updatedAt: string;
}

export type AttemptState = "RUNNING" | "SUCCEEDED" | "FAILED";
export type AttemptTrigger = "manual" | "scheduled" | "catch-up" | "regenerate";

export interface RunAttempt {
  id: string;
  issueId: string;
  edition: number;
  state: AttemptState;
  trigger: AttemptTrigger;
  startedAt: string;
  completedAt: string | null;
  retryable: boolean;
  failureReason: string | null;
  deliveredCount: number;
  traceId: string;
}

export interface TodayIssueResponse {
  issue: DailyIssue | null;
  occurrence: Occurrence | null;
  attempts: RunAttempt[];
}

export interface ArticleProgress {
  issueId: string;
  articleId: string;
  edition: number;
  scrollRatio: number;
  scrollTop: number;
  firstVisibleParagraph: number;
  paragraphOffset: number;
}

export interface ReaderArticleResponse {
  article: ReaderArticleSummary;
  paragraphs: string[] | null;
  progress: ArticleProgress | null;
}

export interface RunResponse {
  attempt: RunAttempt;
  issue: DailyIssue;
}
