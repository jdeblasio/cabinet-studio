/** Shared pieces of the output views: header, issue summary, number formatting, error boundary. */
import { formatLength, inches, sqft, toMm, type CutIssue, type Severity, type Ticks } from '@built-in-planner/engine';
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { useFormatter } from '../../lib/units';
import { locateOwner } from './state';

export function OutputHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="out-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="out-sub">{subtitle}</p>}
      </div>
      <div className="out-actions no-print">{children}</div>
    </header>
  );
}

export function PrintButton() {
  return (
    <button className="primary" onClick={() => window.print()} title="Print this view (the app's toolbar and tabs are left out)">
      Print
    </button>
  );
}

export function Swatch({ color }: { color?: string }) {
  return <span className="out-swatch" style={{ background: color ?? '#ccc' }} aria-hidden />;
}

const ICON: Record<Severity, string> = { error: '●', warning: '▲', info: 'ℹ' };

/** Cut list problems; errors and warnings shown, notes folded. Click one to show it in the design. */
export function IssueSummary({ issues, title = 'Cut list problems' }: { issues: readonly CutIssue[]; title?: string }) {
  const [showNotes, setShowNotes] = useState(false);
  if (issues.length === 0) return null;
  const main = issues.filter((i) => i.severity !== 'info');
  const notes = issues.filter((i) => i.severity === 'info');
  const shown = showNotes ? issues : main;
  const count = (s: Severity) => issues.filter((i) => i.severity === s).length;
  const parts = [
    count('error') && `${count('error')} error${count('error') > 1 ? 's' : ''}`,
    count('warning') && `${count('warning')} warning${count('warning') > 1 ? 's' : ''}`,
    count('info') && `${count('info')} note${count('info') > 1 ? 's' : ''}`,
  ].filter(Boolean);
  return (
    <section className={`out-issues${count('error') ? ' has-errors' : ''}`} aria-label={title}>
      <div className="out-issues-head">
        <strong>{title}</strong>
        <span className="muted">{parts.join(', ')}</span>
        {notes.length > 0 && (
          <button className="link no-print" onClick={() => setShowNotes(!showNotes)}>
            {showNotes ? 'Hide notes' : 'Show notes'}
          </button>
        )}
      </div>
      {shown.length > 0 && (
        <ul>
          {shown.map((issue, i) => (
            <li key={`${issue.code}:${issue.sourceId}:${i}`}>
              <button
                className={`issue ${issue.severity}`}
                title="Show in the design"
                onClick={() => issue.runId && locateOwner({ runId: issue.runId, ownerId: issue.sourceId })}
              >
                <span className="issue-icon">{ICON[issue.severity]}</span>
                {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Unit-aware formatting of areas, long lengths and stock lengths. */
export function useOutputFormat() {
  const f = useFormatter();
  const metric = f.displaySystem === 'metric';
  return {
    ...f,
    metric,
    /** Square ticks → "12.5 sq ft" or "1.16 m²". */
    area: (a: number) => (metric ? `${(a / (320 * 320 * 1e6)).toFixed(2)} m²` : `${sqft(a).toFixed(1)} sq ft`),
    /** Long totals: feet and inches to the inch, or metres. */
    long: (t: Ticks) => (metric ? `${(toMm(t) / 1000).toFixed(2)} m` : formatLength(t, 'imperial', { imperialStyle: 'feetInches', grid: inches(1) })),
    /** Stock board lengths: whole feet as 8', otherwise the usual format. */
    stock: (t: Ticks) => (!metric && t % inches(12) === 0 ? `${t / inches(12)}'` : f.fmt(t)),
    bf: (n: number) => `${n.toFixed(n < 10 ? 2 : 1)} bd ft`,
  };
}

/** Keeps a failure in one output view from taking down the app. */
export class OutputBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Output view failed', error, info.componentStack);
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="output-view">
          <div className="out-issues has-errors">
            <strong>Could not compute this view.</strong> <span className="muted">{this.state.error.message}</span>{' '}
            <button className="link" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
