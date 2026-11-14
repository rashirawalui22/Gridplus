import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Gauge,
  LineChart,
  ShieldCheck,
  Bolt,
  Cpu,
  Zap,
  Filter,
  Settings,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const tabs = ['Overview', 'Grid Monitoring', 'Fault Detection', 'Analytics', 'Alerts', 'Settings'];

function App() {
  const [activeTab, setActiveTab] = useState('Overview');
  const [dashboard, setDashboard] = useState(null);
  const [feeders, setFeeders] = useState([]);
  const [transformers, setTransformers] = useState([]);
  const [faults, setFaults] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  async function handleAcknowledgeAlert(alertId) {
    try {
      const response = await fetch(`/api/alerts/${alertId}/ack`, { method: 'POST' });
      if (!response.ok) return;
      const updatedAlerts = await response.json();
      setAlerts(updatedAlerts);
      await fetchData();
    } catch (error) {
      console.error(error);
    }
  }

  async function handleSaveSettings() {
    if (!settings) return;
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings.thresholds),
      });
      if (response.ok) {
        const nextSettings = await response.json();
        setSettings(nextSettings);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function fetchData() {
    try {
      setLoading(true);
      const [dashRes, feedersRes, transformersRes, faultsRes, alertsRes, settingsRes] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/feeders'),
        fetch('/api/transformers'),
        fetch('/api/faults'),
        fetch('/api/alerts'),
        fetch('/api/settings'),
      ]);

      const dashboardData = await dashRes.json();
      setDashboard(dashboardData);
      setFeeders(await feedersRes.json());
      setTransformers(await transformersRes.json());
      setFaults(await faultsRes.json());
      setAlerts(await alertsRes.json());
      setSettings(await settingsRes.json());
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  const analyticsData = useMemo(() => {
    if (!dashboard?.telemetry) return [];
    return dashboard.telemetry.map((point) => ({
      name: new Date(point.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      voltage: point.voltage,
      frequency: point.frequency,
      load: point.loadPercent,
      power: point.activePower,
    }));
  }, [dashboard]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">Loading GridPulse telemetry…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-glow md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-teal-300">GridPulse</div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-50">Intelligent distribution monitoring</h1>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-300">
            <div className="flex items-center gap-2 text-emerald-400">
              <Activity className="h-4 w-4" />
              <span>Simulation active</span>
            </div>
            <div className="h-2 w-2 rounded-full bg-emerald-400" />
          </div>
        </header>

        <nav className="mb-6 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-full border px-4 py-2 text-sm transition ${
                activeTab === tab
                  ? 'border-teal-400 bg-teal-500/10 text-teal-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {activeTab === 'Overview' && (
          <div className="space-y-6">
            <SummaryCards dashboard={dashboard} />
            <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
              <Panel title="Live telemetry" icon={<LineChart className="h-5 w-5" />}>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={analyticsData}>
                    <defs>
                      <linearGradient id="voltageGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#2dd4bf" stopOpacity={0.7} />
                        <stop offset="95%" stopColor="#2dd4bf" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip />
                    <Area dataKey="voltage" stroke="#2dd4bf" fill="url(#voltageGradient)" />
                  </AreaChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Recent alerts" icon={<Bell className="h-5 w-5" />}>
                <div className="space-y-3">
                  {alerts.slice(0, 4).map((alert) => (
                    <div key={alert.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs uppercase tracking-[0.2em] text-slate-400">{alert.category}</span>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${alert.severity === 'critical' ? 'bg-red-500/15 text-red-300' : alert.severity === 'warning' ? 'bg-yellow-500/15 text-yellow-300' : 'bg-cyan-500/15 text-cyan-300'}`}>
                          {alert.severity}
                        </span>
                      </div>
                      <div className="text-sm text-slate-200">{alert.equipment}</div>
                      <div className="mt-1 text-xs text-slate-400">{alert.description}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Panel title="Power consumption trends" icon={<Bolt className="h-5 w-5" />}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={analyticsData}>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#94a3b8" />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip />
                    <Bar dataKey="power" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
              <Panel title="Equipment status" icon={<ShieldCheck className="h-5 w-5" />}>
                <div className="space-y-4">
                  {[
                    { label: 'Healthy', value: dashboard?.healthyEquipment ?? 0, color: 'bg-emerald-500' },
                    { label: 'Monitoring', value: Math.max(0, (feeders.length || 0) - (dashboard?.healthyEquipment || 0) - 1), color: 'bg-amber-500' },
                    { label: 'Critical', value: dashboard?.criticalAlerts ?? 0, color: 'bg-red-500' },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
                        <span>{stat.label}</span>
                        <span>{stat.value}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div className={`h-full rounded-full ${stat.color}`} style={{ width: `${Math.min(100, stat.value * 18)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </div>
        )}

        {activeTab === 'Grid Monitoring' && (
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Distribution feeders" icon={<Gauge className="h-5 w-5" />}>
              <div className="space-y-3">
                {feeders.map((feeder) => (
                  <div key={feeder.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-slate-100">{feeder.name}</div>
                        <div className="text-xs text-slate-400">{feeder.id} • {feeder.substationId}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${feeder.status === 'warning' ? 'bg-yellow-500/15 text-yellow-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                        {feeder.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
                      <div>Voltage: <span className="text-slate-100">{feeder.voltage.toFixed(1)}V</span></div>
                      <div>Current: <span className="text-slate-100">{feeder.current.toFixed(1)}A</span></div>
                      <div>Frequency: <span className="text-slate-100">{feeder.frequency.toFixed(2)}Hz</span></div>
                      <div>Load: <span className="text-slate-100">{feeder.loadPercent}%</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title="Transformer details" icon={<Cpu className="h-5 w-5" />}>
              <div className="space-y-3">
                {transformers.map((transformer) => (
                  <div key={transformer.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-slate-100">{transformer.name}</div>
                        <div className="text-xs text-slate-400">{transformer.id} • {transformer.substationId}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${transformer.status === 'overload' ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                        {transformer.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm text-slate-300">
                      <div>Rated: <span className="text-slate-100">{transformer.ratingMVA} MVA</span></div>
                      <div>Load: <span className="text-slate-100">{transformer.loadPercent}%</span></div>
                      <div>Voltage: <span className="text-slate-100">{transformer.voltage.toFixed(1)}V</span></div>
                      <div>Current: <span className="text-slate-100">{transformer.currentLoadMVA.toFixed(1)} MVA</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {activeTab === 'Fault Detection' && (
          <div className="space-y-4">
            {faults.map((fault) => (
              <div key={fault.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{fault.category}</div>
                    <h3 className="text-lg font-medium text-slate-50">{fault.equipment}</h3>
                  </div>
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold uppercase ${fault.severity === 'critical' ? 'bg-red-500/15 text-red-300' : 'bg-yellow-500/15 text-yellow-300'}`}>
                    {fault.severity}
                  </span>
                </div>
                <div className="mb-2 text-sm text-slate-200">{fault.description}</div>
                <div className="mb-2 text-xs text-slate-400">{new Date(fault.timestamp).toLocaleString()}</div>
                <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-3 text-sm text-slate-300">
                  <span className="font-medium text-slate-100">Investigation:</span> {fault.recommendation}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Analytics' && (
          <div className="grid gap-6">
            <Panel title="Voltage and frequency" icon={<Zap className="h-5 w-5" />}>
              <ResponsiveContainer width="100%" height={300}>
                <RechartsLineChart data={analyticsData}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Line type="monotone" dataKey="voltage" stroke="#2dd4bf" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="frequency" stroke="#38bdf8" strokeWidth={2} dot={false} />
                </RechartsLineChart>
              </ResponsiveContainer>
            </Panel>
            <Panel title="Transformer loading and power draw" icon={<Filter className="h-5 w-5" />}>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={analyticsData}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Area dataKey="load" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.15} />
                  <Area dataKey="power" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </Panel>
          </div>
        )}

        {activeTab === 'Alerts' && (
          <div className="space-y-4">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="mb-1 flex items-center gap-3">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${alert.severity === 'critical' ? 'bg-red-500/15 text-red-300' : alert.severity === 'warning' ? 'bg-yellow-500/15 text-yellow-300' : 'bg-cyan-500/15 text-cyan-300'}`}>
                      {alert.severity}
                    </span>
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-400">{alert.category}</span>
                  </div>
                  <div className="text-lg font-medium text-slate-50">{alert.equipment}</div>
                  <div className="text-sm text-slate-300">{alert.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{new Date(alert.timestamp).toLocaleString()}</span>
                  {!alert.acknowledged && (
                    <button
                      onClick={() => handleAcknowledgeAlert(alert.id)}
                      className="rounded-lg border border-teal-400 bg-teal-500/10 px-3 py-2 text-sm text-teal-200"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Settings' && settings && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Detection thresholds" icon={<Settings className="h-5 w-5" />}>
              <div className="mb-4 flex justify-end">
                <button
                  onClick={handleSaveSettings}
                  className="rounded-lg border border-teal-400 bg-teal-500/10 px-3 py-2 text-sm text-teal-200"
                >
                  Save thresholds
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(settings.thresholds).map(([key, value]) => (
                  <label key={key} className="block rounded-xl border border-slate-700 bg-slate-900/70 p-3 text-sm text-slate-300">
                    <span className="mb-2 block capitalize text-slate-200">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                    <input
                      className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-slate-50 outline-none focus:border-teal-400"
                      value={value}
                      onChange={(event) => setSettings({
                        ...settings,
                        thresholds: { ...settings.thresholds, [key]: Number(event.target.value) },
                      })}
                    />
                  </label>
                ))}
              </div>
            </Panel>
            <Panel title="System information" icon={<ShieldCheck className="h-5 w-5" />}>
              <div className="space-y-3 text-sm text-slate-300">
                <div className="flex justify-between border-b border-slate-800 pb-2"><span>Simulation mode</span><span className="text-slate-100">Synthetic data only</span></div>
                <div className="flex justify-between border-b border-slate-800 pb-2"><span>Data source</span><span className="text-slate-100">Operational telemetry model</span></div>
                <div className="flex justify-between border-b border-slate-800 pb-2"><span>Network health</span><span className="text-slate-100">{dashboard?.reliability ?? 96.8}%</span></div>
                <div className="flex justify-between border-b border-slate-800 pb-2"><span>Alerting engine</span><span className="text-slate-100">Threshold-based</span></div>
              </div>
            </Panel>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCards({ dashboard }) {
  const cards = [
    { label: 'Total monitored feeders', value: dashboard?.totalFeeders ?? 0, icon: Gauge },
    { label: 'Active transformers', value: dashboard?.activeTransformers ?? 0, icon: Cpu },
    { label: 'Healthy equipment', value: dashboard?.healthyEquipment ?? 0, icon: ShieldCheck },
    { label: 'Critical alerts', value: dashboard?.criticalAlerts ?? 0, icon: AlertTriangle },
    { label: 'Average voltage', value: `${dashboard?.averageVoltage ?? 0}V`, icon: Zap },
    { label: 'Average frequency', value: `${dashboard?.averageFrequency ?? 0}Hz`, icon: Bolt },
    { label: 'Total power', value: `${dashboard?.totalPowerConsumption ?? 0} MW`, icon: Activity },
    { label: 'System reliability', value: `${dashboard?.reliability ?? 0}%`, icon: Bell },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map(({ label, value, icon: Icon }) => (
        <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/30">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm text-slate-400">{label}</span>
            <div className="rounded-lg bg-slate-800 p-2 text-teal-300">
              <Icon className="h-4 w-4" />
            </div>
          </div>
          <div className="text-3xl font-semibold text-slate-50">{value}</div>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, icon, children }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/20">
      <div className="mb-4 flex items-center gap-2 text-slate-100">
        <div className="rounded-lg bg-slate-800 p-2 text-teal-300">{icon}</div>
        <h2 className="text-lg font-medium">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default App;
