import type { Severity } from '@built-in-planner/engine';
import { useRunResult } from '../store/derived';
import { selectionForId } from '../store/selection';
import { useActiveRun, useEditor } from '../store/store';

const ICON: Record<Severity, string> = { error: '●', warning: '▲', info: 'ℹ' };
const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export function Problems() {
  const run = useActiveRun();
  const result = useRunResult();
  const select = useEditor((s) => s.select);
  const issues = [...result.issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return (
    <div className="problems">
      <div className="problems-head">
        <strong>Problems</strong>
        {issues.length === 0 ? (
          <span className="muted">No problems</span>
        ) : (
          <span className="muted">
            {counts.error ? `${counts.error} error${counts.error > 1 ? 's' : ''}` : ''}
            {counts.error && counts.warning ? ', ' : ''}
            {counts.warning ? `${counts.warning} warning${counts.warning > 1 ? 's' : ''}` : ''}
            {(counts.error || counts.warning) && counts.info ? ', ' : ''}
            {counts.info ? `${counts.info} note${counts.info > 1 ? 's' : ''}` : ''}
          </span>
        )}
      </div>
      {issues.length > 0 && (
        <ul>
          {issues.map((issue, i) => (
            <li key={`${issue.code}:${issue.sourceId}:${i}`}>
              <button className={`issue ${issue.severity}`} onClick={() => select(selectionForId(run, issue.sourceId, result))} title={issue.code}>
                <span className="issue-icon">{ICON[issue.severity]}</span>
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
