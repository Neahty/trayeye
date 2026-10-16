// Очередь подносов с остатками от поваров. Gemini считает запросы, а не картинки,
// поэтому копим подносы школы и отправляем пачкой: как только набралось batchSize
// или прошло waitMs с первого подноса в очереди.

class TrayQueue {
  // flush(schoolId, items) - отправить пачку; ошибки обрабатывает сам.
  constructor({ flush, batchSize = 8, waitMs = 45000 }) {
    this.flush = flush;
    this.batchSize = batchSize;
    this.waitMs = waitMs;
    this.pending = new Map(); // schoolId -> { items, timer }
  }

  add(schoolId, item) {
    const entry = this.pending.get(schoolId) || { items: [], timer: null };
    entry.items.push(item);
    this.pending.set(schoolId, entry);
    if (entry.items.length >= this.batchSize) return this.flushSchool(schoolId);
    if (!entry.timer) entry.timer = setTimeout(() => this.flushSchool(schoolId), this.waitMs);
    return null;
  }

  async flushSchool(schoolId) {
    const entry = this.pending.get(schoolId);
    if (!entry) return;
    this.pending.delete(schoolId);
    clearTimeout(entry.timer);
    await this.flush(schoolId, entry.items);
  }

  async flushAll() {
    await Promise.all([...this.pending.keys()].map((id) => this.flushSchool(id)));
  }

  size() {
    let n = 0;
    for (const e of this.pending.values()) n += e.items.length;
    return n;
  }
}

module.exports = { TrayQueue };
