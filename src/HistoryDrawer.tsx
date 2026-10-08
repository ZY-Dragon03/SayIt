import { useEffect, useRef, useState } from "react";
import type { HistoryRecord } from "./lib/history";
import type { DailyIssue, ReaderArticleSummary } from "./reader/types";

export type HistorySection = "reading" | "expressions";

export interface HistoryDrawerProps {
  open: boolean;
  /** The workspace the drawer was opened from; decides the default section. */
  mode: "sayit" | "reader";
  /** True while the Reader workspace is showing an open article. */
  readingArticleOpen: boolean;
  todayIssue: DailyIssue | null;
  archiveIssues: DailyIssue[];
  historyItems: HistoryRecord[];
  /** Preview an expression result without entering the SayIt workspace. */
  onPreviewExpression: (record: HistoryRecord) => void;
  onOpenExpression: (record: HistoryRecord) => void;
  onOpenReading: (article: ReaderArticleSummary) => void;
  onShowToday: () => void;
  onReadArticle: () => void;
  onClose: () => void;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function formatHistoryTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function historyTitle(record: HistoryRecord): string {
  return record.result.mode === "interpret"
    ? record.result.interpretation?.expression ?? record.input
    : record.result.best_match?.text ?? record.input;
}

function historySummary(record: HistoryRecord): string {
  if (record.result.mode === "interpret") {
    return record.result.interpretation?.meaning_in_context ?? record.input;
  }
  return record.result.natural_sentence ?? record.input;
}

/**
 * One History drawer for the whole shell.
 *
 * Reading keeps Daily Issues, articles and progress; Expressions keeps the SayIt
 * query and interpretation history recorded by either workspace. The two
 * storage models stay separate — this only presents them side by side, defaults
 * to the section belonging to the active mode, and lets the reader switch
 * sections without switching workspaces.
 */
export function HistoryDrawer({
  open,
  mode,
  readingArticleOpen,
  todayIssue,
  archiveIssues,
  historyItems,
  onPreviewExpression,
  onOpenExpression,
  onOpenReading,
  onShowToday,
  onReadArticle,
  onClose,
}: HistoryDrawerProps) {
  const [section, setSection] = useState<HistorySection>(
    mode === "reader" ? "reading" : "expressions",
  );
  const wasOpenRef = useRef(false);

  // Follow the active mode when the drawer is opened, but never while it is
  // already open: switching sections must not fight the reader.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      setSection(mode === "reader" ? "reading" : "expressions");
    }
  }, [mode, open]);

  if (!open) return null;

  const byDate = new Map<string, DailyIssue>();
  for (const issue of [todayIssue, ...archiveIssues]) {
    if (issue && !byDate.has(issue.localDate)) byDate.set(issue.localDate, issue);
  }
  const readingIssues = [...byDate.values()].sort((left, right) =>
    right.localDate.localeCompare(left.localDate),
  );
  const todayDate = todayIssue?.localDate ?? null;

  const openExpression = (record: HistoryRecord) => {
    if (mode === "reader") {
      onPreviewExpression(record);
      return;
    }
    onOpenExpression(record);
  };

  return (
    <div
      className="drawer-layer history-layer"
      role="presentation"
      onMouseDown={onClose}
    >
      <aside
        className="saved-drawer history-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="History"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2>History</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close history"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="history-sections" role="tablist" aria-label="History sections">
          <button
            type="button"
            role="tab"
            aria-selected={section === "reading"}
            className={`history-section-tab ${section === "reading" ? "is-active" : ""}`}
            onClick={() => setSection("reading")}
          >
            Reading
            <span className="history-section-count">{readingIssues.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "expressions"}
            className={`history-section-tab ${section === "expressions" ? "is-active" : ""}`}
            onClick={() => setSection("expressions")}
          >
            Expressions
            <span className="history-section-count">{historyItems.length}</span>
          </button>
        </div>

        {section === "reading" ? (
          readingIssues.length > 0 ? (
            <ul className="reader-archive-list history-reading-list">
              {readingIssues.map((issue) => {
                const isToday = issue.localDate === todayDate;
                return (
                  <li key={`${issue.id}-${issue.edition}`}>
                    <div className="history-issue-head">
                      <span>{isToday ? `Today · ${formatDate(issue.localDate)}` : formatDate(issue.localDate)}</span>
                      {!isToday && (
                        <button
                          type="button"
                          className="history-inline-action"
                          onClick={onShowToday}
                        >
                          Today
                        </button>
                      )}
                    </div>
                    {issue.articles.length > 0 ? (
                      <ul className="history-article-list">
                        {issue.articles.map((article) => (
                          <li key={article.id}>
                            <button
                              type="button"
                              className="reader-archive-date"
                              onClick={() => onOpenReading(article)}
                            >
                              <span>{article.title}</span>
                              <span>
                                {article.originalPublication || article.accessiblePublication || "Publisher unknown"}
                                {` · ${article.readState === "READ" ? "read" : article.readState === "IN_PROGRESS" ? "in progress" : "unread"}`}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="history-issue-empty">No delivered articles</p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="drawer-empty">
              <p>Daily Issues will collect here.</p>
            </div>
          )
        ) : historyItems.length === 0 ? (
          <div className="drawer-empty">
            <span className="empty-icon" aria-hidden="true">◷</span>
            <p>Successful results will appear here automatically.</p>
          </div>
        ) : (
          <ul className="saved-list history-list">
            {historyItems.map((item) => (
              <li className="saved-list-item history-list-item" key={item.id}>
                <button
                  className="saved-item history-item"
                  type="button"
                  onClick={() => openExpression(item)}
                >
                  <span className="history-item-meta">
                    <span className="history-mode">{item.mode}</span>
                    <time dateTime={item.created_at}>
                      {formatHistoryTime(item.created_at)}
                    </time>
                  </span>
                  <strong>{historyTitle(item)}</strong>
                  <span>{historySummary(item)}</span>
                </button>
                {mode === "reader" && (
                  <button
                    type="button"
                    className="history-inline-action"
                    onClick={() => onOpenExpression(item)}
                  >
                    Open in SayIt
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {section === "reading" && mode === "reader" && readingArticleOpen && (
          <button type="button" className="history-return-action" onClick={onReadArticle}>
            Back to the open article
          </button>
        )}      </aside>
    </div>
  );
}
