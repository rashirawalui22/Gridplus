import { Panel } from './Panel';

function stateColor(status) {
  if (status === 'critical' || status === 'overload') return '#fb7185';
  if (status === 'warning' || status === 'degraded') return '#fbbf24';
  return '#34d399';
}

function equipmentDetails(id, snapshot) {
  return snapshot.substations.find((item) => item.id === id)
    || snapshot.feeders.find((item) => item.id === id)
    || snapshot.transformers.find((item) => item.id === id);
}

export default function TopologyView({ snapshot, selectedId, onSelect }) {
  const groups = snapshot.substations.map((substation, substationIndex) => {
    const associatedFeeders = snapshot.feeders.filter((item) => item.substationId === substation.id);
    const centerY = 70 + substationIndex * 100;
    return {
      substation,
      centerY,
      rows: associatedFeeders.map((feeder, feederIndex) => ({
        feeder,
        transformer: snapshot.transformers.find((item) => item.id === feeder.transformerId),
        y: centerY + (feederIndex - (associatedFeeders.length - 1) / 2) * 28,
      })),
    };
  });
  const selected = selectedId ? equipmentDetails(selectedId, snapshot) : null;

  const Node = ({ id, name, x, y, status }) => (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Select ${name} ${id}`}
      onClick={() => onSelect(id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect(id);
      }}
      className="cursor-pointer"
    >
      <circle cx={x} cy={y} r="15" fill="#0f172a" stroke={stateColor(status)} strokeWidth="2" />
      <circle cx={x} cy={y} r="4" fill={stateColor(status)} />
      <text x={x} y={y + 29} textAnchor="middle" fill="#cbd5e1" fontSize="11">{id}</text>
      <title>{`${name} · ${status}`}</title>
    </g>
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <Panel title="Distribution network · simulated power flow">
        <div className="overflow-x-auto">
          <svg viewBox="0 0 880 350" className="min-w-[700px] w-full" role="img" aria-label="Interactive distribution network topology">
            <text x="100" y="24" textAnchor="middle" fill="#64748b" fontSize="11">SUBSTATION</text>
            <text x="440" y="24" textAnchor="middle" fill="#64748b" fontSize="11">FEEDER</text>
            <text x="770" y="24" textAnchor="middle" fill="#64748b" fontSize="11">TRANSFORMER</text>
            {groups.map(({ substation, centerY, rows }) => (
              <g key={substation.id}>
                <path d={`M 136 ${centerY} L 250 ${centerY}`} fill="none" stroke="#1e3a4c" strokeWidth="2" />
                {rows.length > 1 && <path d={`M 250 ${rows[0].y} L 250 ${rows.at(-1).y}`} fill="none" stroke="#1e3a4c" strokeWidth="2" />}
                <Node id={substation.id} name={substation.name} x={120} y={centerY} status={substation.status} />
                {rows.map(({ feeder, transformer, y }) => (
                  <g key={feeder.id}>
                    <path d={`M 250 ${centerY} L 250 ${y} L 440 ${y} L 770 ${y}`} fill="none" stroke="#1e3a4c" strokeWidth="2" className="power-flow" />
                    <Node id={feeder.id} name={feeder.name} x={440} y={y} status={feeder.status} />
                    {transformer && <Node id={transformer.id} name={transformer.name} x={770} y={y} status={transformer.status} />}
                  </g>
                ))}
              </g>
            ))}
          </svg>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-emerald-400" />Normal</span>
          <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-amber-400" />Warning</span>
          <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-rose-400" />Critical</span>
          <span>Click an asset for current simulated readings.</span>
        </div>
      </Panel>
      <Panel title="Asset details">
        {selected ? (
          <div className="space-y-3">
            <div>
              <div className="font-semibold text-slate-100">{selected.name}</div>
              <div className="text-xs text-slate-500">{selected.id}</div>
            </div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
              <span className="text-slate-400">Status</span>
              <span style={{ color: stateColor(selected.status) }}>{selected.status}</span>
            </div>
            {selected.voltage !== undefined && <Detail label="Voltage" value={`${selected.voltage} V`} />}
            {selected.current !== undefined && <Detail label="Current" value={`${selected.current} A`} />}
            {selected.frequency !== undefined && <Detail label="Frequency" value={`${selected.frequency} Hz`} />}
            {selected.activePower !== undefined && <Detail label="Active power" value={`${selected.activePower} MW`} />}
            {selected.reactivePower !== undefined && <Detail label="Reactive power" value={`${selected.reactivePower} MVAr`} />}
            {selected.loadPercent !== undefined && <Detail label="Load" value={`${selected.loadPercent}%`} />}
            {selected.ratingMVA !== undefined && <Detail label="Rated capacity" value={`${selected.ratingMVA} MVA`} />}
            {selected.reliability !== undefined && <Detail label="Reliability" value={`${selected.reliability}%`} />}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Select a substation, feeder or transformer in the topology.</p>
        )}
      </Panel>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 pb-2 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="tabular-nums text-slate-200">{value}</span>
    </div>
  );
}
