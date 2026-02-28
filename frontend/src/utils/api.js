import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({ baseURL: BASE_URL });

/**
 * Submit a tool job
 * @param {string} endpoint - e.g. '/organize/merge'
 * @param {File[]} files
 * @param {Object} fields - form field values
 * @param {Function} onProgress - (percent: number) => void
 */
export async function submitJob(endpoint, files, fields = {}, onProgress) {
  const form = new FormData();

  // Append files
  if (files.length === 1) {
    form.append('file', files[0]);
  } else {
    files.forEach(f => form.append('files', f));
  }

  // Append fields
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      form.append(k, v);
    }
  });

  const res = await api.post(endpoint, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
    timeout: 120_000, // 2 min
  });

  return res.data;
}

/**
 * Get a download URL for a processed file
 */
export function getDownloadUrl(filename) {
  return `${BASE_URL}/files/${filename}`;
}

export default api;
