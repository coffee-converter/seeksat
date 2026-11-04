// lib/passes/pass-client.mjs - run pass jobs in a Web Worker, inline if none.
import { runPassJob } from './pass-jobs.mjs';

export function defaultMakeWorker() {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./pass.worker.js', import.meta.url), { type: 'module' });
}

export function createPassRunner({ makeWorker = defaultMakeWorker } = {}) {
  let worker = null;
  let started = false;
  let nextId = 1;
  const pending = new Map(); // id -> { job, resolve, reject }

  const inline = (job) =>
    new Promise((resolve, reject) => {
      try {
        resolve(runPassJob(job));
      } catch (e) {
        reject(e);
      }
    });

  function fallBack() {
    const w = worker;
    worker = null;
    try {
      w?.terminate?.();
    } catch {
      // already gone
    }
    const waiting = [...pending.values()];
    pending.clear();
    for (const p of waiting) inline(p.job).then(p.resolve, p.reject);
  }

  function ensureWorker() {
    if (started) return worker;
    started = true;
    try {
      worker = makeWorker();
    } catch {
      worker = null;
    }
    if (worker) {
      worker.onmessage = (e) => {
        const { id, ok, result, error } = e.data;
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        if (ok) p.resolve(result);
        else p.reject(new Error(error));
      };
      worker.onerror = (e) => {
        e?.preventDefault?.();
        fallBack();
      };
    }
    return worker;
  }

  return {
    run(job) {
      const w = ensureWorker();
      if (!w) return inline(job);
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { job, resolve, reject });
        try {
          w.postMessage({ id, job });
        } catch {
          fallBack();
        }
      });
    },
    dispose() {
      const w = worker;
      worker = null;
      started = true; // after dispose, jobs run inline
      w?.terminate?.();
      for (const p of pending.values()) p.reject(new Error('Pass runner disposed'));
      pending.clear();
    },
  };
}

let singleton = null;
export function getPassRunner() {
  if (!singleton) singleton = createPassRunner();
  return singleton;
}
