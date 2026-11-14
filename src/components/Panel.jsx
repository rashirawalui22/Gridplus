export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900 p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ children }) {
  return <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">{children}</div>;
}

export function MetricCard({ label, value, icon: Icon, tone = 'cyan' }) {
  const toneClasses = {
    cyan: 'text-cyan-300 bg-cyan-400/10',
    blue: 'text-sky-300 bg-sky-400/10',
    amber: 'text-amber-300 bg-amber-400/10',
    red: 'text-rose-300 bg-rose-400/10',
    green: 'text-emerald-300 bg-emerald-400/10',
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-slate-400">{label}</span>
        <span className={`rounded-lg p-2 ${toneClasses[tone]}`}>
          <Icon size={16} aria-hidden="true" />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums text-slate-50">{value}</div>
    </div>
  );
}
