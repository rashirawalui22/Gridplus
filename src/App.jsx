import { useCallback, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bolt,
  Bot,
  ChartNoAxesCombined,
  CirclePause,
  CirclePlay,
  Cpu,
  Download,
  Gauge,
  LayoutDashboard,
  Network,
  Printer,
  Radio,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Siren,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, MetricCard, Panel } from './components/Panel';
import TopologyView from './components/TopologyView';

const navigation = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Grid Topology', icon: Network },
  { label: 'Live Monitoring', icon: Radio },
  { label: 'Analytics', icon: ChartNoAxesCombined },
  { label: 'Equipment', icon: Cpu },
  { label: 'Fault Detection', icon: AlertTriangle },
  { label: 'Alerts', icon: Bell },
  { label: 'Incident Management', icon: Siren },
  { label: 'Load Forecasting', icon: ChartNoAxesCombined },
  { label: 'Scenario Simulator', icon: Bolt },
  { label: 'AI Assistant', icon: Bot },
  { label: 'Reports', icon: Download },
  { label: 'Settings', icon: Settings },
];

async function requestJson(url, options) {
  const headers = new Headers(options?.headers || {});
  const token = sessionStorage.getItem('gridpulse-token');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed with status ${response.status}`);
  return result;
}

function snapshotForDashboard(snapshot) {
  return {
    ...snapshot.dashboard,
    telemetry: snapshot.telemetry,
    generatedAt: snapshot.generatedAt,
  };
}

function chartPoint(dashboard) {
  return {
    time: new Date(dashboard.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    timestamp: dashboard.generatedAt,
    voltage: dashboard.averageVoltage,
    frequency: dashboard.averageFrequency,
    power: dashboard.totalPowerConsumption,
  };
}

function App() {
  const [activePage, setActivePage] = useState('Overview');
  const [dashboard, setDashboard] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [faults, setFaults] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [settings, setSettings] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [simulation, setSimulation] = useState({ running: false });
  const [connection, setConnection] = useState('connecting');
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedAsset, setSelectedAsset] = useState('F-202');
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState(null);

  const applySnapshot = useCallback((nextSnapshot) => {
    if (!nextSnapshot?.dashboard || !Array.isArray(nextSnapshot.telemetry)) return;
    setSnapshot(nextSnapshot);
    const nextDashboard = snapshotForDashboard(nextSnapshot);
    setDashboard(nextDashboard);
    setTrend((previous) => {
      const point = chartPoint(nextDashboard);
      if (previous.at(-1)?.time === point.time) return previous;
      return [...previous, point].slice(-60);
    });
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [snapshotData, forecastData] = await Promise.all([
        requestJson('/api/snapshot'),
        requestJson('/api/forecast?hours=24'),
      ]);
      applySnapshot(snapshotData);
      setFaults(snapshotData.faults);
      setAlerts(snapshotData.alerts);
      setIncidents(snapshotData.incidents);
      setSettings(snapshotData.settings);
      setSimulation(snapshotData.settings.simulation);
      setForecast(forecastData);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    let active = true;
    async function checkAuthentication() {
      try {
        const status = await requestJson('/api/auth/status');
        if (!active) return;
        setAuthEnabled(status.enabled);
        const token = sessionStorage.getItem('gridpulse-token');
        if (status.enabled && token) {
          try {
            setUser(await requestJson('/api/auth/me'));
          } catch {
            sessionStorage.removeItem('gridpulse-token');
          }
        }
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setAuthReady(true);
      }
    }
    checkAuthentication();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!authReady) return undefined;
    if (authEnabled && !user) {
      setLoading(false);
      return undefined;
    }
    loadData();
    const socket = io({
      path: '/socket.io',
      auth: { token: sessionStorage.getItem('gridpulse-token') },
      reconnection: true,
      reconnectionDelayMax: 5000,
    });
    socket.on('connect', () => setConnection('connected'));
    socket.on('disconnect', () => setConnection('disconnected'));
    socket.on('connect_error', () => setConnection('disconnected'));
    socket.on('telemetry:snapshot', applySnapshot);
    socket.on('simulation:status', setSimulation);
    socket.on('alerts:update', setAlerts);
    socket.on('fault:new', (fault) => setFaults((previous) => [fault, ...previous].slice(0, 100)));
    socket.on('incident:new', (incident) => setIncidents((previous) => [incident, ...previous].slice(0, 100)));
    return () => socket.close();
  }, [applySnapshot, authEnabled, authReady, loadData, user]);

  const execute = useCallback(async (url, options, successMessage) => {
    setNotice('');
    setError('');
    try {
      const result = await requestJson(url, options);
      if (successMessage) setNotice(successMessage);
      return result;
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    }
  }, []);

  const updateForecast = useCallback(async (hours) => {
    try {
      setForecast(await requestJson(`/api/forecast?hours=${hours}`));
    } catch (requestError) {
      setError(requestError.message);
    }
  }, []);

  async function changeIncidentStatus(incidentId, status) {
    try {
      const updated = await execute(`/api/incidents/${incidentId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }, `Incident ${incidentId} moved to ${status.toLowerCase()}.`);
      setIncidents((previous) => previous.map((item) => item.id === incidentId ? updated : item));
    } catch {
      return;
    }
  }

  async function acknowledgeAlert(alertId) {
    try {
      const updated = await execute(`/api/alerts/${alertId}/ack`, { method: 'POST' }, 'Alert acknowledged.');
      setAlerts((previous) => previous.map((item) => item.id === alertId ? updated : item));
    } catch {
      return;
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    try {
      const updated = await execute('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings.thresholds),
      }, 'Detection thresholds saved.');
      setSettings(updated);
      setSimulation(updated.simulation);
    } catch {
      return;
    }
  }

  if (authReady && authEnabled && !user) {
    return <AuthScreen onAuthenticated={(result) => {
      sessionStorage.setItem('gridpulse-token', result.token);
      setUser(result.user);
      setLoading(true);
    }} />;
  }

  if (loading) {
    return <LoadingScreen />;
  }

  if (!snapshot) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
        <div className="mx-auto mt-20 max-w-lg rounded-xl border border-rose-900/60 bg-slate-900 p-6">
          <h1 className="text-xl font-semibold">GridPulse API is unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{error || 'Unable to load simulated network data.'}</p>
          <button onClick={() => { setLoading(true); loadData(); }} className="mt-5 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950">Retry connection</button>
        </div>
      </div>
    );
  }

  const canOperate = !authEnabled || ['ADMIN', 'OPERATOR'].includes(user?.role);
  const canAdmin = !authEnabled || user?.role === 'ADMIN';

  return (
    <div className="min-h-screen bg-[#070d18] text-slate-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-slate-800 bg-[#0b1321] lg:flex lg:flex-col">
          <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
            <div className="rounded-lg bg-cyan-400/10 p-2 text-cyan-300"><Activity size={20} /></div>
            <div>
              <div className="font-semibold tracking-wide text-white">GRIDPULSE</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Distribution operations</div>
            </div>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Main navigation">
            {navigation.map(({ label, icon: Icon }) => (
              <button
                key={label}
                onClick={() => setActivePage(label)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${activePage === label ? 'bg-cyan-400/10 text-cyan-200' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'}`}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
                {label === 'Incident Management' && incidents.filter((item) => item.status !== 'RESOLVED').length > 0 && (
                  <span className="ml-auto rounded-full bg-rose-400/15 px-2 py-0.5 text-[10px] text-rose-300">
                    {incidents.filter((item) => item.status !== 'RESOLVED').length}
                  </span>
                )}
              </button>
            ))}
          </nav>
          <div className="border-t border-slate-800 p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-700 text-sm font-semibold">DO</div>
              <div>
                <div className="text-sm text-slate-200">{user?.name || 'Local demo operator'}</div>
                  <div className="text-xs text-slate-500">{user?.role || 'Local simulation mode'}</div>
              </div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-10 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#070d18]/95 px-4 py-3 backdrop-blur md:px-6">
            <div>
              <div className="text-sm font-semibold text-slate-100">{activePage}</div>
              <div className="text-xs text-slate-500">Synthetic distribution network · Not connected to a utility grid</div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 ${connection === 'connected' ? 'border-emerald-900 bg-emerald-400/5 text-emerald-300' : 'border-amber-900 bg-amber-400/5 text-amber-300'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${connection === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {connection === 'connected' ? 'Live stream connected' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting'}
              </span>
              <span className="hidden text-slate-500 sm:inline">Updated {dashboard.generatedAt ? new Date(dashboard.generatedAt).toLocaleTimeString() : '—'}</span>
              <button
                onClick={() => setActivePage('Incident Management')}
                className="relative rounded-lg border border-slate-800 p-2 text-slate-400 hover:text-white"
                aria-label="Open incidents"
              >
                <Bell size={16} />
                {incidents.some((item) => item.severity === 'critical' && item.status !== 'RESOLVED') && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-400" />}
              </button>
              {authEnabled && <button onClick={async () => {
                try { await requestJson('/api/auth/logout', { method: 'POST' }); } catch { /* local token removal still ends this session */ }
                sessionStorage.removeItem('gridpulse-token');
                setUser(null);
                setSnapshot(null);
                setLoading(false);
              }} className="rounded-lg border border-slate-800 px-3 py-2 text-slate-400 hover:text-white">Sign out</button>}
            </div>
          </header>

          <div className="space-y-4 p-4 md:p-6">
            <nav className="flex gap-1 overflow-x-auto pb-2 lg:hidden" aria-label="Mobile navigation">
              {navigation.map(({ label, icon: Icon }) => (
                <button key={label} onClick={() => setActivePage(label)} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs ${activePage === label ? 'bg-cyan-400/10 text-cyan-200' : 'bg-slate-900 text-slate-400'}`}>
                  <Icon size={14} />{label}
                </button>
              ))}
            </nav>
            {error && <InlineMessage kind="error" onClose={() => setError('')}>{error}</InlineMessage>}
            {notice && <InlineMessage kind="success" onClose={() => setNotice('')}>{notice}</InlineMessage>}

            {activePage === 'Overview' && (
              <Overview
                dashboard={dashboard}
                trend={trend}
                alerts={alerts}
                incidents={incidents}
                onAcknowledge={acknowledgeAlert}
                onNavigate={setActivePage}
                canOperate={canOperate}
              />
            )}
            {activePage === 'Grid Topology' && (
              <TopologyView snapshot={snapshot} selectedId={selectedAsset} onSelect={setSelectedAsset} />
            )}
            {activePage === 'Live Monitoring' && (
              <LiveMonitoring
                snapshot={snapshot}
                running={simulation.running}
                canOperate={canOperate}
                onControl={async (action) => {
                  try {
                    const updated = await execute(`/api/simulation/${action}`, { method: 'POST' }, `Simulation ${action === 'pause' ? 'paused' : action === 'start' ? 'started' : 'reset'}.`);
                    setSimulation(updated);
                    if (action === 'reset') await loadData();
                  } catch { return; }
                }}
              />
            )}
            {activePage === 'Analytics' && <Analytics snapshot={snapshot} trend={trend} />}
            {activePage === 'Equipment' && <Equipment snapshot={snapshot} />}
            {activePage === 'Fault Detection' && <FaultDetection faults={faults} />}
            {activePage === 'Alerts' && <AlertManagement alerts={alerts} onAcknowledge={acknowledgeAlert} canOperate={canOperate} />}
            {activePage === 'Incident Management' && (
              <IncidentManagement incidents={incidents} onStatusChange={changeIncidentStatus} canOperate={canOperate} />
            )}
            {activePage === 'Load Forecasting' && (
              <LoadForecasting forecast={forecast} onIntervalChange={updateForecast} />
            )}
            {activePage === 'Scenario Simulator' && (
              <ScenarioSimulator
                snapshot={snapshot}
                canOperate={canOperate}
                onCreate={async (input) => {
                  try {
                    return await execute('/api/scenarios', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(input),
                    }, 'Hypothetical scenario applied to the simulation.');
                  } catch { return null; }
                }}
                onReset={async () => {
                  try {
                    await execute('/api/scenarios/current', { method: 'DELETE' }, 'Scenario cleared.');
                  } catch { return; }
                }}
              />
            )}
            {activePage === 'AI Assistant' && <Assistant onAsk={execute} />}
            {activePage === 'Reports' && <Reports dashboard={dashboard} incidents={incidents} faults={faults} />}
            {activePage === 'Settings' && settings && (
              <SettingsPage settings={settings} onChange={setSettings} onSubmit={saveSettings} canAdmin={canAdmin} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#070d18] p-6 text-slate-100">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 h-12 w-72 animate-pulse rounded-lg bg-slate-800" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />)}
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="h-80 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
          <div className="h-80 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
        </div>
      </div>
    </div>
  );
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setWorking(true);
    setError('');
    try {
      const result = await requestJson(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      onAuthenticated(result);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[#070d18] p-4 text-slate-100">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg bg-cyan-400/10 p-2 text-cyan-300"><Activity size={20} /></div>
          <div><div className="font-semibold tracking-wide">GRIDPULSE</div><div className="text-xs text-slate-500">Secure operator access</div></div>
        </div>
        <h1 className="text-lg font-semibold">{mode === 'login' ? 'Sign in' : 'Create a viewer account'}</h1>
        <form onSubmit={submit} className="mt-4 space-y-3">
          {mode === 'register' && <label className="block text-xs text-slate-400">Name<input required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" /></label>}
          <label className="block text-xs text-slate-400">Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" /></label>
          <label className="block text-xs text-slate-400">Password<input required type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" /></label>
          {error && <div role="alert" className="rounded-md border border-rose-900 bg-rose-950/30 p-2 text-xs text-rose-200">{error}</div>}
          <button disabled={working} className="w-full rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{working ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Register'}</button>
        </form>
        <button onClick={() => { setError(''); setMode(mode === 'login' ? 'register' : 'login'); }} className="mt-4 text-xs text-cyan-300 hover:text-cyan-200">
          {mode === 'login' ? 'Need an account? Register' : 'Already registered? Sign in'}
        </button>
        {mode === 'register' && <p className="mt-3 text-[11px] text-slate-500">New accounts receive viewer access. An administrator must grant operator or admin privileges.</p>}
      </div>
    </div>
  );
}

function InlineMessage({ kind, children, onClose }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${kind === 'error' ? 'border-rose-900/70 bg-rose-950/30 text-rose-200' : 'border-emerald-900/70 bg-emerald-950/30 text-emerald-200'}`}>
      <span>{children}</span>
      <button onClick={onClose} className="text-xs opacity-70 hover:opacity-100">Dismiss</button>
    </div>
  );
}

function Overview({ dashboard, trend, alerts, incidents, onAcknowledge, onNavigate, canOperate }) {
  const cards = [
    { label: 'Substations', value: dashboard.totalSubstations, icon: Network, tone: 'blue' },
    { label: 'Active feeders', value: dashboard.activeFeeders, icon: Gauge, tone: 'green' },
    { label: 'Active transformers', value: dashboard.activeTransformers, icon: Cpu, tone: 'cyan' },
    { label: 'Average voltage', value: `${dashboard.averageVoltage} V`, icon: Zap, tone: 'cyan' },
    { label: 'Average frequency', value: `${dashboard.averageFrequency} Hz`, icon: Activity, tone: 'blue' },
    { label: 'Simulated demand', value: `${dashboard.totalPowerConsumption} MW`, icon: Bolt, tone: 'amber' },
    { label: 'System reliability', value: `${dashboard.reliability}%`, icon: ShieldCheck, tone: 'green' },
    { label: 'Critical alerts', value: dashboard.criticalAlerts, icon: AlertTriangle, tone: dashboard.criticalAlerts ? 'red' : 'green' },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => <MetricCard key={card.label} {...card} />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <Panel title="Network telemetry">
          <div className="mb-2 flex gap-4 text-xs text-slate-400">
            <span className="text-cyan-300">Voltage (V)</span><span className="text-sky-300">Frequency (Hz)</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="#64748b" minTickGap={30} />
              <YAxis yAxisId="voltage" stroke="#64748b" domain={['auto', 'auto']} />
              <YAxis yAxisId="frequency" orientation="right" stroke="#64748b" domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
              <Line yAxisId="voltage" type="monotone" dataKey="voltage" stroke="#22d3ee" dot={false} strokeWidth={2} />
              <Line yAxisId="frequency" type="monotone" dataKey="frequency" stroke="#38bdf8" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
          {trend.length < 2 && <p className="text-xs text-slate-500">Collecting telemetry samples for trend display…</p>}
        </Panel>
        <Panel title="Equipment health">
          <HealthSummary snapshot={dashboard} />
          <button onClick={() => onNavigate('Grid Topology')} className="mt-5 text-xs font-medium text-cyan-300 hover:text-cyan-200">Open network topology →</button>
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Recent incidents" action={<button onClick={() => onNavigate('Incident Management')} className="text-xs text-cyan-300">View all →</button>}>
          <IncidentList incidents={incidents.slice(0, 4)} />
        </Panel>
        <Panel title="Latest alerts" action={<button onClick={() => onNavigate('Fault Detection')} className="text-xs text-cyan-300">Fault centre →</button>}>
          <AlertList alerts={alerts.slice(0, 4)} onAcknowledge={onAcknowledge} canOperate={canOperate} />
        </Panel>
      </div>
    </div>
  );
}

function HealthSummary({ snapshot }) {
  const total = snapshot.totalFeeders || 1;
  const values = [
    { label: 'Healthy', value: snapshot.healthyEquipment, color: 'bg-emerald-400' },
    { label: 'Monitoring', value: Math.max(0, total - snapshot.healthyEquipment - snapshot.criticalAlerts), color: 'bg-amber-400' },
    { label: 'Critical', value: snapshot.criticalAlerts, color: 'bg-rose-400' },
  ];
  return (
    <div className="space-y-4">
      {values.map((item) => (
        <div key={item.label}>
          <div className="mb-1.5 flex justify-between text-xs text-slate-400"><span>{item.label}</span><span>{item.value}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className={`h-full rounded-full ${item.color}`} style={{ width: `${Math.min(100, item.value / total * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveMonitoring({ snapshot, running, onControl, canOperate }) {
  return (
    <div className="space-y-4">
      <Panel title="Simulation controls" action={<span className="text-xs text-slate-500">All readings are synthetic</span>}>
        {canOperate ? <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => onControl(running ? 'pause' : 'start')} className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950">
            {running ? <CirclePause size={16} /> : <CirclePlay size={16} />}{running ? 'Pause' : 'Resume'}
          </button>
          <button onClick={() => onControl('reset')} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">
            <RotateCcw size={15} />Reset simulation
          </button>
          <span className={`ml-auto rounded-full px-3 py-1 text-xs ${running ? 'bg-emerald-400/10 text-emerald-300' : 'bg-slate-700 text-slate-300'}`}>{running ? 'RUNNING' : 'PAUSED'}</span>
        </div> : <p className="text-sm text-slate-400">Your viewer role can monitor telemetry but cannot control the simulation.</p>}
      </Panel>
      <Panel title={`Current telemetry · ${snapshot.telemetry.length} channels`}>
        <TelemetryTable readings={snapshot.telemetry} />
      </Panel>
    </div>
  );
}

function TelemetryTable({ readings }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>{['Feeder', 'Substation', 'Voltage', 'Current', 'Frequency', 'Active power', 'Reactive power', 'Load', 'State'].map((head) => <th key={head} className="border-b border-slate-800 px-3 py-3 font-medium">{head}</th>)}</tr>
        </thead>
        <tbody>
          {readings.map((item) => (
            <tr key={item.feederId} className="border-b border-slate-800/70 last:border-0">
              <td className="px-3 py-3"><div className="font-medium text-slate-200">{item.feederId}</div><div className="text-xs text-slate-500">{item.feederName}</div></td>
              <td className="px-3 py-3 text-slate-400">{item.substationId}</td>
              <td className="px-3 py-3 tabular-nums">{item.voltage} V</td>
              <td className="px-3 py-3 tabular-nums">{item.current} A</td>
              <td className="px-3 py-3 tabular-nums">{item.frequency} Hz</td>
              <td className="px-3 py-3 tabular-nums">{item.activePower} MW</td>
              <td className="px-3 py-3 tabular-nums">{item.reactivePower} MVAr</td>
              <td className="px-3 py-3 tabular-nums">{item.loadPercent}%</td>
              <td className="px-3 py-3"><StatusBadge status={item.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Equipment({ snapshot }) {
  const [query, setQuery] = useState('');
  const matches = (item) => `${item.id} ${item.name} ${item.substationId}`.toLowerCase().includes(query.toLowerCase());
  return (
    <div className="space-y-4">
      <SearchInput value={query} onChange={setQuery} placeholder="Search equipment by name or ID…" />
      <Panel title="Feeders">
        <TelemetryTable readings={snapshot.telemetry.filter(matches)} />
      </Panel>
      <Panel title="Transformers">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {snapshot.transformers.filter(matches).map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex items-start justify-between"><div><div className="font-medium">{item.name}</div><div className="text-xs text-slate-500">{item.id} · {item.substationId}</div></div><StatusBadge status={item.status} /></div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-400">
                <span>Rated <b className="text-slate-200">{item.ratingMVA} MVA</b></span>
                <span>Load <b className="text-slate-200">{item.loadPercent}%</b></span>
                <span>Current <b className="text-slate-200">{item.currentLoadMVA} MVA</b></span>
                <span>Voltage <b className="text-slate-200">{item.voltage} V</b></span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function Analytics({ snapshot, trend }) {
  const [windowHours, setWindowHours] = useState(1);
  const [feederId, setFeederId] = useState('all');
  const selectedReadings = snapshot.telemetry.filter((item) => feederId === 'all' || item.feederId === feederId);
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const windowedTrend = trend.filter((point) => new Date(point.timestamp).getTime() >= cutoff);
  return (
    <div className="space-y-4">
      <Panel title="Analytics filters" action={<span className="text-[11px] text-slate-500">Historical series is retained in this session</span>}>
        <div className="flex flex-wrap gap-3">
          <label className="text-xs text-slate-400">Time range
            <select value={windowHours} onChange={(event) => setWindowHours(Number(event.target.value))} className="ml-2 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200">
              <option value={0.25}>15 minutes</option><option value={1}>1 hour</option><option value={6}>6 hours</option><option value={24}>24 hours</option>
            </select>
          </label>
          <label className="text-xs text-slate-400">Feeder
            <select value={feederId} onChange={(event) => setFeederId(event.target.value)} className="ml-2 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-200">
              <option value="all">All feeders</option>
              {snapshot.feeders.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
            </select>
          </label>
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="System voltage and frequency">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={windowedTrend}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="time" stroke="#64748b" minTickGap={30} />
              <YAxis yAxisId="v" stroke="#64748b" domain={['auto', 'auto']} />
              <YAxis yAxisId="f" orientation="right" stroke="#64748b" domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
              <Line yAxisId="v" type="monotone" dataKey="voltage" name="Voltage (V)" stroke="#22d3ee" dot={false} />
              <Line yAxisId="f" type="monotone" dataKey="frequency" name="Frequency (Hz)" stroke="#60a5fa" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Current feeder loading and demand">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={selectedReadings}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
              <XAxis dataKey="feederId" stroke="#64748b" />
              <YAxis stroke="#64748b" />
              <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
              <Area type="monotone" dataKey="loadPercent" name="Load (%)" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.12} />
              <Area type="monotone" dataKey="activePower" name="Power (MW)" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.1} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </div>
  );
}

function AlertManagement({ alerts, onAcknowledge, canOperate }) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const filtered = [...alerts]
    .filter((item) => `${item.equipment} ${item.category} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
    .filter((item) => severity === 'all' || item.severity === severity)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search by equipment…" />
        <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
          <option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="informational">Informational</option>
        </select>
      </div>
      <Panel title={`${filtered.length} alerts · newest first`}>
        <AlertList alerts={filtered} onAcknowledge={onAcknowledge} canOperate={canOperate} />
      </Panel>
    </div>
  );
}

function FaultDetection({ faults }) {
  return (
    <Panel title={`${faults.length} detected fault events`}>
      {faults.length ? (
        <div className="space-y-3">
          {faults.map((fault) => (
            <div key={fault.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><span className="font-semibold text-slate-100">{fault.category.replaceAll('-', ' ')}</span><span className="ml-2 text-xs text-slate-500">{fault.equipment} · {fault.id}</span></div>
                <StatusBadge status={fault.severity} />
              </div>
              <p className="mt-2 text-sm text-slate-300">{fault.description}</p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                <span>Score {fault.anomalyScore ?? '—'}</span><span>{new Date(fault.timestamp).toLocaleString()}</span><span>{fault.status}</span>
              </div>
              <p className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-xs text-slate-400"><b className="text-slate-300">Suggested investigation:</b> {fault.recommendation}</p>
            </div>
          ))}
        </div>
      ) : <EmptyState>No faults detected in the current simulation history.</EmptyState>}
    </Panel>
  );
}

function IncidentManagement({ incidents, onStatusChange, canOperate }) {
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState('all');
  const filtered = incidents.filter((item) => (
    (!query || `${item.id} ${item.equipment} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
    && (severity === 'all' || item.severity === severity)
  ));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search incidents…" />
        <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">
          <option value="all">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="informational">Informational</option>
        </select>
      </div>
      <Panel title={`${filtered.length} incidents`}>
        {filtered.length ? <IncidentList incidents={filtered} onStatusChange={onStatusChange} showAudit canOperate={canOperate} /> : <EmptyState>No incidents match these filters.</EmptyState>}
      </Panel>
    </div>
  );
}

function IncidentList({ incidents, onStatusChange, showAudit = false, canOperate = false }) {
  if (!incidents.length) return <EmptyState>No incidents recorded yet. New detections will appear here.</EmptyState>;
  return (
    <div className="space-y-3">
      {incidents.map((incident) => (
        <details key={incident.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`h-2 w-2 shrink-0 rounded-full ${incident.severity === 'critical' ? 'bg-rose-400' : incident.severity === 'warning' ? 'bg-amber-400' : 'bg-sky-400'}`} />
              <div className="truncate"><span className="font-medium text-slate-200">{incident.id}</span><span className="ml-2 text-xs text-slate-500">{incident.equipment} · {incident.description}</span></div>
            </div>
            <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-300">{incident.status}</span>
          </summary>
          <div className="mt-3 border-t border-slate-800 pt-3">
            <div className="text-xs text-slate-500">Created {new Date(incident.createdAt).toLocaleString()} · Assigned to {incident.assignedTo}</div>
            <p className="mt-2 text-sm text-slate-300">{incident.recommendation}</p>
            {showAudit && (
              <>
                {canOperate && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {incident.status === 'OPEN' && <button onClick={() => onStatusChange(incident.id, 'ACKNOWLEDGED')} className="button-small">Acknowledge</button>}
                  {incident.status === 'ACKNOWLEDGED' && <button onClick={() => onStatusChange(incident.id, 'INVESTIGATING')} className="button-small">Start investigation</button>}
                  {incident.status !== 'RESOLVED' && <button onClick={() => onStatusChange(incident.id, 'RESOLVED')} className="button-small">Resolve</button>}
                </div>
                )}
                <div className="mt-3 space-y-1 text-xs text-slate-500">
                  {incident.auditHistory.map((entry, index) => <div key={`${incident.id}-${index}`}>{entry.status} · {entry.actor} · {new Date(entry.timestamp).toLocaleString()}</div>)}
                </div>
              </>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function LoadForecasting({ forecast, onIntervalChange }) {
  const [interval, setInterval] = useState(24);
  return (
    <div className="space-y-4">
      <Panel title="Demand forecast" action={(
        <select value={interval} onChange={(event) => { const hours = Number(event.target.value); setInterval(hours); onIntervalChange(hours); }} className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs">
          {[1, 3, 6, 12, 24].map((hours) => <option key={hours} value={hours}>{hours} hour{hours === 1 ? '' : 's'}</option>)}
        </select>
      )}>
        {forecast && (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-400">
              <span>Baseline <b className="text-slate-200">{forecast.baselineMW} MW</b></span>
              <span>Method <b className="text-slate-200">{forecast.method}</b></span>
              <span>Samples <b className="text-slate-200">{forecast.sampleCount}</b></span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={forecast.forecast}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="#64748b" minTickGap={25} />
                <YAxis stroke="#64748b" unit=" MW" />
                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155' }} />
                <Area type="monotone" dataKey="predictedMW" name="Forecast MW" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.14} />
              </AreaChart>
            </ResponsiveContainer>
            <p className="mt-3 text-xs text-amber-300">Forecast is an unvalidated statistical baseline over synthetic demand, not an operational prediction. Error metrics are unavailable until future actual samples exist.</p>
          </>
        )}
      </Panel>
    </div>
  );
}

function ScenarioSimulator({ snapshot, onCreate, onReset, canOperate }) {
  const [targetId, setTargetId] = useState('SS-02');
  const [mode, setMode] = useState('outage');
  const [amount, setAmount] = useState(20);
  const [result, setResult] = useState(null);
  const [working, setWorking] = useState(false);
  const assets = [...snapshot.substations, ...snapshot.feeders, ...snapshot.transformers];

  async function submit(event) {
    event.preventDefault();
    setWorking(true);
    const scenarioInput = {
      targetId,
      mode,
      ...(mode === 'load' ? { loadDeltaPercent: Number(amount) } : {}),
      ...(mode === 'voltage' ? { voltageDelta: Number(amount) } : {}),
    };
    const response = await onCreate(scenarioInput);
    if (response) setResult(response);
    setWorking(false);
  }

  async function reset() {
    await onReset();
    setResult(null);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Panel title="What-if scenario">
        {canOperate ? <form onSubmit={submit} className="space-y-4">
          <label className="block text-xs text-slate-400">Equipment target
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
              {assets.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}
            </select>
          </label>
          <label className="block text-xs text-slate-400">Scenario
            <select value={mode} onChange={(event) => setMode(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100">
              <option value="outage">Equipment outage</option><option value="load">Change load</option><option value="voltage">Voltage change</option>
            </select>
          </label>
          {mode !== 'outage' && (
            <label className="block text-xs text-slate-400">{mode === 'load' ? 'Load delta (percentage points)' : 'Voltage delta (V)'}
              <input type="number" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
            </label>
          )}
          <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">Hypothetical simulation only. This does not represent a real outage or control action.</div>
          <div className="flex gap-2">
            <button disabled={working} className="flex-1 rounded-lg bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60">{working ? 'Calculating…' : 'Run scenario'}</button>
            <button type="button" onClick={reset} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300">Reset</button>
          </div>
        </form> : <p className="text-sm text-slate-400">Your viewer role can inspect grid data but cannot run scenarios.</p>}
      </Panel>
      <Panel title="Impact assessment">
        {result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><div className="font-semibold">{result.scenario.targetName}</div><div className="text-xs text-slate-500">{result.scenario.id} · {result.scenario.mode} · hypothetical</div></div>
              <StatusBadge status={result.impact.severity} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ImpactMetric label="Affected load" value={`${result.impact.affectedLoadMW} MW`} />
              <ImpactMetric label="Estimated consumers" value={result.impact.estimatedConsumersAffected.toLocaleString()} />
              <ImpactMetric label="Alternate capacity" value={`${result.impact.availableAlternativeCapacityMVA} MVA`} />
              <ImpactMetric label="Capacity sufficient" value={result.impact.alternativeCapacitySufficient ? 'Estimated yes' : 'Estimated no'} />
            </div>
            <div>
              <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Affected equipment</div>
              <div className="flex flex-wrap gap-2">{result.impact.affectedEquipment.map((id) => <span key={id} className="rounded-md border border-slate-700 px-2 py-1 text-xs">{id}</span>)}</div>
            </div>
          </div>
        ) : <EmptyState>Choose equipment and a what-if condition to calculate a synthetic impact assessment.</EmptyState>}
      </Panel>
    </div>
  );
}

function ImpactMetric({ label, value }) {
  return <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-semibold text-slate-100">{value}</div></div>;
}

function Assistant({ onAsk }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [working, setWorking] = useState(false);
  const suggestions = ['Which transformer has the highest load?', 'Which feeders have voltage abnormalities?', 'What is current system reliability?', 'What happens if Substation SS-02 fails?'];

  async function submit(event, suggestedQuestion) {
    event?.preventDefault();
    const prompt = suggestedQuestion || question.trim();
    if (!prompt || working) return;
    setWorking(true);
    setQuestion('');
    try {
      const answer = await onAsk('/api/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: prompt }),
      });
      setMessages((previous) => [...previous, { prompt, ...answer }]);
    } catch { /* the global error banner displays request failures */ }
    setWorking(false);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Panel title="GridPulse data assistant">
        <p className="mb-4 text-sm text-slate-400">Answers are generated from the current application snapshot and simulated incident records. No external AI service is used.</p>
        <div className="flex flex-wrap gap-2">
          {suggestions.map((item) => <button key={item} onClick={(event) => submit(event, item)} className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-cyan-500">{item}</button>)}
        </div>
        <div className="mt-5 space-y-3">
          {messages.map((message, index) => (
            <div key={`${index}-${message.prompt}`} className="space-y-2">
              <div className="ml-auto max-w-[85%] rounded-lg bg-slate-800 p-3 text-sm">{message.prompt}</div>
              <div className="max-w-[90%] rounded-lg border border-cyan-900/60 bg-cyan-950/20 p-3 text-sm text-slate-200">
                {message.answer}
                {message.evidence?.length > 0 && <pre className="mt-2 overflow-auto text-[10px] text-cyan-200/70">{JSON.stringify(message.evidence, null, 2)}</pre>}
                <div className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">{message.simulated ? 'Based on simulated data' : ''}</div>
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={submit} className="mt-5 flex gap-2">
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about current GridPulse data…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          <button disabled={working || !question.trim()} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{working ? 'Thinking…' : 'Ask'}</button>
        </form>
      </Panel>
    </div>
  );
}

function Reports({ dashboard, incidents, faults }) {
  const generatedAt = new Date(dashboard.generatedAt);
  const generatedLabel = Number.isNaN(generatedAt.getTime()) ? 'Unavailable' : generatedAt.toLocaleString();
  const openIncidents = incidents.filter((incident) => incident.status !== 'RESOLVED').length;
  const criticalFaults = faults.filter((fault) => fault.severity === 'critical').length;

  return (
    <div className="print-report space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">GridPulse · Simulated operations</p>
          <h1 className="mt-1 text-xl font-semibold text-slate-100">System status report</h1>
          <p className="mt-1 text-xs text-slate-400">Snapshot generated {generatedLabel} · Synthetic data, not utility telemetry</p>
        </div>
        <button onClick={() => window.print()} className="print-hide inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-cyan-200 hover:border-cyan-500">
          <Printer size={16} aria-hidden="true" />
          Print / Save as PDF
        </button>
      </div>

      <div className="report-metrics grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Substations" value={dashboard.totalSubstations} icon={Network} />
        <MetricCard label="Active feeders" value={dashboard.activeFeeders} icon={Radio} />
        <MetricCard label="Active transformers" value={dashboard.activeTransformers} icon={Cpu} />
        <MetricCard label="Average voltage" value={`${dashboard.averageVoltage} V`} icon={Gauge} />
        <MetricCard label="Average frequency" value={`${dashboard.averageFrequency} Hz`} icon={Activity} />
        <MetricCard label="Simulated power" value={`${dashboard.totalPowerConsumption} MW`} icon={Zap} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Operational summary" className="print-avoid-break">
          <div className="space-y-3 text-sm">
            <DetailRow label="System reliability" value={`${dashboard.reliability}%`} />
            <DetailRow label="Open incidents" value={openIncidents} />
            <DetailRow label="Fault events" value={faults.length} />
            <DetailRow label="Critical fault events" value={criticalFaults} />
            <DetailRow label="Data source" value="Synthetic simulation" />
          </div>
        </Panel>
        <Panel title="Available exports" className="print-hide">
          <div className="space-y-3">
            <ReportLink href="/api/reports/telemetry.csv" label="Telemetry history (CSV)" detail="Time series of simulated demand, voltage and frequency" />
          </div>
          <p className="mt-4 text-xs text-slate-500">The CSV contains the in-memory simulation history only; it is not utility telemetry.</p>
        </Panel>
      </div>

      <Panel title="Recent fault events" className="print-avoid-break">
        {faults.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-slate-500"><tr><th className="py-2 pr-3">Detected</th><th className="py-2 pr-3">Equipment</th><th className="py-2 pr-3">Category</th><th className="py-2 pr-3">Severity</th><th className="py-2">Finding</th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {faults.slice(0, 15).map((fault) => (
                  <tr key={fault.id}>
                    <td className="py-2 pr-3 text-slate-400">{new Date(fault.timestamp).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-medium text-slate-200">{fault.equipment}</td>
                    <td className="py-2 pr-3">{fault.category}</td>
                    <td className="py-2 pr-3">{fault.severity}</td>
                    <td className="py-2 text-slate-400">{fault.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No fault events in the current simulation.</EmptyState>}
      </Panel>

      <Panel title="Recent incidents" className="print-avoid-break">
        {incidents.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-slate-500"><tr><th className="py-2 pr-3">Created</th><th className="py-2 pr-3">Incident</th><th className="py-2 pr-3">Equipment</th><th className="py-2 pr-3">Severity / status</th><th className="py-2">Recommendation</th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {incidents.slice(0, 15).map((incident) => (
                  <tr key={incident.id}>
                    <td className="py-2 pr-3 text-slate-400">{new Date(incident.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-medium text-slate-200">{incident.id}</td>
                    <td className="py-2 pr-3">{incident.equipment}</td>
                    <td className="py-2 pr-3">{incident.severity} / {incident.status}</td>
                    <td className="py-2 text-slate-400">{incident.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No incidents recorded in the current simulation.</EmptyState>}
      </Panel>
    </div>
  );
}

function ReportLink({ href, label, detail }) {
  return (
    <a href={href} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 hover:border-slate-600">
      <span><span className="block text-sm font-medium">{label}</span><span className="text-xs text-slate-500">{detail}</span></span><Download size={17} className="text-cyan-300" />
    </a>
  );
}

function SettingsPage({ settings, onChange, onSubmit, canAdmin }) {
  const fields = [
    ['voltageMin', 'Minimum voltage (V)'],
    ['voltageMax', 'Maximum voltage (V)'],
    ['frequencyMin', 'Minimum frequency (Hz)'],
    ['frequencyMax', 'Maximum frequency (Hz)'],
    ['overloadPercent', 'Transformer overload (%)'],
    ['powerDeviationPercent', 'Power deviation (%)'],
    ['loadSpikePercent', 'Load spike (percentage points)'],
    ['telemetryGapSeconds', 'Telemetry gap (seconds)'],
    ['tickIntervalMs', 'Simulation interval (ms)'],
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Detection and simulation configuration">
        <form onSubmit={onSubmit}>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map(([key, label]) => (
              <label key={key} className="text-xs text-slate-400">{label}
                <input disabled={!canAdmin} type="number" step="any" value={settings.thresholds[key]} onChange={(event) => onChange({
                  ...settings,
                  thresholds: { ...settings.thresholds, [key]: Number(event.target.value) },
                })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100" />
              </label>
            ))}
          </div>
          {canAdmin && <button className="mt-4 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">Save configuration</button>}
          {!canAdmin && <p className="mt-4 text-xs text-slate-500">Only administrators may change thresholds.</p>}
        </form>
      </Panel>
      <Panel title="System information">
        <div className="space-y-3 text-sm">
          <DetailRow label="Application" value="GridPulse" />
          <DetailRow label="Mode" value="Synthetic data" />
          <DetailRow label="Detection" value="Rules + load-spike check" />
          <DetailRow label="Simulation" value={settings.simulation.running ? 'Running' : 'Paused'} />
          <DetailRow label="Interval" value={`${settings.simulation.tickIntervalMs} ms`} />
          <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">No actual grid, protective devices, or utility systems are connected.</div>
        </div>
      </Panel>
    </div>
  );
}

function AlertList({ alerts, onAcknowledge, canOperate }) {
  if (!alerts.length) return <EmptyState>No alerts are available.</EmptyState>;
  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <div key={alert.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 p-3">
          <div className="min-w-0"><div className="flex items-center gap-2"><StatusBadge status={alert.severity} /><span className="text-xs text-slate-400">{alert.equipment} · {alert.category}</span></div><p className="mt-1 text-xs text-slate-300">{alert.description}</p></div>
          {canOperate && !alert.acknowledged && alert.status === 'open' && <button onClick={() => onAcknowledge(alert.id)} className="text-xs text-cyan-300 hover:text-cyan-200">Acknowledge</button>}
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }) {
  const normalized = String(status).toLowerCase();
  const style = normalized === 'critical' || normalized === 'overload'
    ? 'bg-rose-400/10 text-rose-300'
    : normalized === 'warning' || normalized === 'degraded'
      ? 'bg-amber-400/10 text-amber-300'
      : normalized === 'resolved' || normalized === 'normal'
        ? 'bg-emerald-400/10 text-emerald-300'
        : 'bg-slate-700 text-slate-300';
  return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-wide ${style}`}>{status}</span>;
}

function SearchInput({ value, onChange, placeholder }) {
  return (
    <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-500">
      <Search size={15} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500" />
    </label>
  );
}

function DetailRow({ label, value }) {
  return <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2 text-xs"><span className="text-slate-500">{label}</span><span className="text-right text-slate-200">{value}</span></div>;
}

export default App;
