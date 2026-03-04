import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: BASE_URL });

// Poll a job status URL until done or error.
// Calls onProgress(99) on each tick to keep the spinner alive.
async function pollJob(statusUrl, onProgress) {
  while (true) {
    await new Promise(r => setTimeout(r, 3000)); // wait 3 seconds between polls
    const { data } = await api.get(statusUrl, { timeout: 15_000 });
    if (data.status === 'done')  return data;
    if (data.status === 'error') throw new Error(data.error || 'Processing failed.');
    if (onProgress) onProgress(99); // keep spinner alive
  }
}

/**
 * Submit a tool job.
 * If the server returns { jobId, status: 'processing' }, switches to polling mode
 * so large files (like compress) never hit the upload timeout.
 */
export async function submitJob(endpoint, files, fields = {}, onProgress) {
  const form = new FormData();

  if (files.length === 1) {
    form.append('file', files[0]);
  } else {
    files.forEach(f => form.append('files', f));
  }

  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') form.append(k, v);
  });

  const res = await api.post(endpoint, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
    },
    timeout: 120_000, // 2 min — only covers the upload, not backend processing
  });

  // Async job pattern: server returned a jobId to poll
  if (res.data.jobId && res.data.status === 'processing') {
    if (onProgress) onProgress(100); // upload done, processing starts
    const statusUrl = `${endpoint}/status/${res.data.jobId}`;
    return await pollJob(statusUrl, onProgress);
  }

  return res.data;
}

/**
 * Get a download URL for a processed file
 */
export function getDownloadUrl(filename) {
  return `${BASE_URL}/files/${filename}`;
}

export default api;
