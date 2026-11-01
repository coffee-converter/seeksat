// Module Web Worker: runs pass-search jobs off the main thread.
import { runPassJob } from './pass-jobs.mjs';

self.onmessage = (e) => {
  const { id, job } = e.data;
  try {
    self.postMessage({ id, ok: true, result: runPassJob(job) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
