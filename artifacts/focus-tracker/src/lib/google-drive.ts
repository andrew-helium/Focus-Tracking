import type { SyncStore } from './google-sheets';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const BACKUP_FILE_NAME = 'focus-tracker-backup.json';

export function storeToBackupJson(store: SyncStore): string {
  return JSON.stringify({ categories: store.categories, tasks: store.tasks, sessions: store.sessions }, null, 2);
}

export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export class DriveError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function multipartBody(boundary: string, metadata: Record<string, string>, content: string): string {
  const delimiter = `--${boundary}`;
  return (
    `${delimiter}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `${delimiter}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`
  );
}

async function uploadMultipart(
  token: string,
  url: string,
  method: 'POST' | 'PATCH',
  metadata: Record<string, string>,
  content: string,
): Promise<{ id: string }> {
  const boundary = `focus-tracker-${Math.random().toString(36).slice(2)}`;
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody(boundary, metadata, content),
  });
  const data = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!response.ok || !data.id) {
    throw new DriveError(data.error?.message || `Google Drive error (${response.status})`, response.status);
  }
  return { id: data.id };
}

export async function uploadBackup(
  token: string,
  options: { fileId?: string; name: string; content: string },
): Promise<{ id: string; created: boolean }> {
  if (options.fileId) {
    try {
      const updated = await uploadMultipart(
        token,
        `https://www.googleapis.com/upload/drive/v3/files/${options.fileId}?uploadType=multipart`,
        'PATCH',
        { mimeType: 'application/json' },
        options.content,
      );
      return { id: updated.id, created: false };
    } catch (error) {
      if (!(error instanceof DriveError) || error.status !== 404) throw error;
    }
  }
  const created = await uploadMultipart(
    token,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    'POST',
    { name: options.name, mimeType: 'application/json' },
    options.content,
  );
  return { id: created.id, created: true };
}
