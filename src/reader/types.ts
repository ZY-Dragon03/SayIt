import type { z } from "zod";
import {
  archiveResponseSchema,
  articleResponseSchema,
  articleSummarySchema,
  dailyIssueSchema,
  issueEditionResponseSchema,
  getPreferencesResponseSchema,
  putProgressRequestSchema,
  putProgressResponseSchema,
  readerDifficultySchema,
  readerPreferencesSchema,
  readingProgressSchema,
  runResponseSchema,
  todayResponseSchema,
} from "../shared/reader-contract";
import type {
  ArticleContentStatus,
  ArticleReadState,
  ArticleSummary,
  CachePermission,
  DailyIssue as ContractDailyIssue,
  IssueActual,
  IssueStatus,
  Occurrence,
  ReaderDifficulty as ContractReaderDifficulty,
  ReaderPreferences as ContractReaderPreferences,
  RunAttempt,
  RunAttemptState,
  RunAttemptTrigger,
} from "../shared/reader-contract";

export type ReaderDifficulty = ContractReaderDifficulty;
export type ReaderIssueStatus = IssueStatus;
export type ReaderContentStatus = ArticleContentStatus;
export type ReaderReadState = ArticleReadState;
export type ReaderCachePermission = CachePermission;
export type ReaderPreferences = ContractReaderPreferences;
export type ReaderIssueTarget = ReaderPreferences;
export type ReaderIssueActual = IssueActual;
export type ReaderArticleSummary = ArticleSummary;
export type DailyIssue = ContractDailyIssue;
export type AttemptState = RunAttemptState;
export type AttemptTrigger = RunAttemptTrigger;
export type ReaderRunAttempt = RunAttempt;
export type { RunAttempt };

export interface PriorEditionSummary {
  edition: number;
}

export type TodayIssueResponse = z.infer<typeof todayResponseSchema>;
export type ReaderArchiveResponse = z.infer<typeof archiveResponseSchema>;
export type ReaderEditionResponse = z.infer<typeof issueEditionResponseSchema>;
export type ReaderArticleResponse = z.infer<typeof articleResponseSchema>;
export type RunResponse = z.infer<typeof runResponseSchema>;
export type ReaderPreferencesResponse = z.infer<typeof getPreferencesResponseSchema>;
export type ReaderProgressRequest = z.infer<typeof putProgressRequestSchema>;
export type ReaderProgressResponse = z.infer<typeof putProgressResponseSchema>;

export type ArticleProgress = Pick<
  z.infer<typeof readingProgressSchema>,
  | "issueId"
  | "articleId"
  | "edition"
  | "scrollRatio"
  | "scrollTop"
  | "firstVisibleParagraph"
  | "paragraphOffset"
>;

export type ReaderContractIssue = z.infer<typeof dailyIssueSchema>;
export type ReaderContractPreferences = z.infer<typeof readerPreferencesSchema>;
export type ReaderContractDifficulty = z.infer<typeof readerDifficultySchema>;
export type ReaderContractArticle = z.infer<typeof articleSummarySchema>;
export type ReaderOccurrence = Occurrence;
