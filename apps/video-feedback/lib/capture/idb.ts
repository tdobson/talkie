import type { CompleteBody } from '@/lib/types';
import type { PendingChunk } from './uploader';

/** A chunk as kept in IndexedDB. `acked` chunks stay until their comment is completed. */
export interface StoredChunk extends PendingChunk {
  acked: boolean;
}

/** A complete call that has been asked for but not yet confirmed by the server. */
export interface PendingComplete {
  key: string;
  token: string;
  sid: string;
  cid: string;
  body: CompleteBody;
  /**
   * True for a record the uploader wrote itself as chunks arrived, before the page asked for
   * the comment to be completed. If the tab goes away mid-comment this is all that is left to
   * say where the comment ended, and the next visit completes the comment from it.
   */
  provisional?: boolean;
  /** Date.now() when a provisional record was last written. */
  updatedAt?: number;
}

// Audio is stored as bytes plus a type: not every engine can structured-clone a Blob into IndexedDB.
type ChunkRow = Omit<StoredChunk, 'audio'> & { bytes: ArrayBuffer; audioType: string };

const CHUNKS = 'chunks';
const COMPLETES = 'completes';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** Tiny IndexedDB wrapper holding unconfirmed upload chunks and complete calls. */
export class ChunkStoreIdb {
  private db: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;

  constructor(dbName = 'video-feedback-capture') {
    this.dbName = dbName;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          for (const name of [CHUNKS, COMPLETES]) {
            const os = req.result.createObjectStore(name, { keyPath: 'key' });
            os.createIndex('token', 'token');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        req.onblocked = () => reject(new Error('IndexedDB open blocked'));
      });
      // A failed open (private mode, quota) should be retried on the next call.
      this.db.catch(() => {
        this.db = null;
      });
    }
    return this.db;
  }

  private async run<T>(
    name: string,
    mode: IDBTransactionMode,
    fn: (os: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(name, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    const result = await request(fn(tx.objectStore(name)));
    await done;
    return result;
  }

  async putChunk(chunk: StoredChunk): Promise<void> {
    const { audio, ...rest } = chunk;
    const row: ChunkRow = { ...rest, bytes: await audio.arrayBuffer(), audioType: audio.type };
    await this.run(CHUNKS, 'readwrite', (os) => os.put(row));
  }

  async deleteChunk(key: string): Promise<void> {
    await this.run(CHUNKS, 'readwrite', (os) => os.delete(key));
  }

  async chunksForToken(token: string): Promise<StoredChunk[]> {
    const rows = await this.run<ChunkRow[]>(CHUNKS, 'readonly', (os) =>
      os.index('token').getAll(token)
    );
    return rows.map(({ bytes, audioType, ...rest }) => ({
      ...rest,
      audio: new Blob([bytes], { type: audioType }),
    }));
  }

  async putComplete(rec: PendingComplete): Promise<void> {
    await this.run(COMPLETES, 'readwrite', (os) => os.put(rec));
  }

  async deleteComplete(key: string): Promise<void> {
    await this.run(COMPLETES, 'readwrite', (os) => os.delete(key));
  }

  completesForToken(token: string): Promise<PendingComplete[]> {
    return this.run<PendingComplete[]>(COMPLETES, 'readonly', (os) =>
      os.index('token').getAll(token)
    );
  }
}
