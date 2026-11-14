const statuses = ['OPEN', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'];
const nextStatus = new Map([
  ['OPEN', new Set(['ACKNOWLEDGED'])],
  ['ACKNOWLEDGED', new Set(['INVESTIGATING', 'RESOLVED'])],
  ['INVESTIGATING', new Set(['RESOLVED'])],
  ['RESOLVED', new Set()],
]);

export class IncidentService {
  constructor() {
    this.incidents = [];
    this.sequence = 0;
  }

  hydrate(items) {
    this.incidents = items.map(({ _id, __v, ...incident }) => incident);
    this.sequence = this.incidents.reduce((highest, item) => {
      const match = item.id?.match(/^INC-(\d+)$/);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
  }

  createFromFault(fault) {
    if (this.incidents.some((item) => item.sourceFaultId === fault.id)) return null;
    this.sequence += 1;
    const now = new Date().toISOString();
    const incident = {
      id: `INC-${String(this.sequence).padStart(5, '0')}`,
      sourceFaultId: fault.id,
      severity: fault.severity,
      equipment: fault.equipment,
      category: fault.category,
      description: fault.description,
      recommendation: fault.recommendation,
      status: 'OPEN',
      assignedTo: 'Unassigned',
      createdAt: now,
      updatedAt: now,
      auditHistory: [{ status: 'OPEN', actor: 'system', timestamp: now }],
    };
    this.incidents.unshift(incident);
    this.incidents = this.incidents.slice(0, 500);
    return incident;
  }

  list(filters = {}) {
    const search = String(filters.search ?? '').trim().toLowerCase();
    const severity = String(filters.severity ?? '').toLowerCase();
    const status = String(filters.status ?? '').toUpperCase();
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 100));
    const offset = Math.max(0, Number(filters.offset) || 0);
    const items = this.incidents
      .filter((item) => !search || `${item.id} ${item.equipment} ${item.description}`.toLowerCase().includes(search))
      .filter((item) => !severity || item.severity === severity)
      .filter((item) => !status || item.status === status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { total: items.length, limit, offset, items: items.slice(offset, offset + limit) };
  }

  transition(id, status, actor = 'operator') {
    const updated = this.prepareTransition(id, status, actor);
    if (!updated) return null;
    this.commit(updated);
    return updated;
  }

  prepareTransition(id, status, actor = 'operator') {
    const incident = this.incidents.find((item) => item.id === id);
    if (!incident) return null;
    if (!statuses.includes(status) || !nextStatus.get(incident.status).has(status)) {
      const error = new Error(`Cannot transition incident from ${incident.status} to ${status}.`);
      error.status = 409;
      throw error;
    }

    const timestamp = new Date().toISOString();
    return {
      ...incident,
      status,
      updatedAt: timestamp,
      auditHistory: [...incident.auditHistory, { status, actor, timestamp }],
    };
  }

  commit(incident) {
    const index = this.incidents.findIndex((item) => item.id === incident.id);
    if (index === -1) return null;
    this.incidents[index] = incident;
    return incident;
  }
}
