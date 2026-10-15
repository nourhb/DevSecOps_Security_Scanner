import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Repository, ScanRecord } from "@/lib/domain";

export type StoreData = {
  repositories: Repository[];
  scans: ScanRecord[];
};

export type ScanStore = {
  listRepositories(): Promise<Repository[]>;
  listScans(): Promise<ScanRecord[]>;
  getRepository(id: string): Promise<Repository | undefined>;
  getScan(id: string): Promise<ScanRecord | undefined>;
  insertRepository(repository: Repository): Promise<Repository>;
  insertScan(scan: ScanRecord): Promise<ScanRecord>;
  updateScan(id: string, patch: Partial<Omit<ScanRecord, "id" | "repositoryId" | "createdAt">>): Promise<ScanRecord | undefined>;
  transaction<T>(mutator: (data: StoreData) => T): Promise<T>;
};

const stores = new Map<string, ScanStore>();

export function storeFilePath(): string {
  return process.env.SECUREREPO_STORE ?? path.join(process.cwd(), "data", "store.json");
}

export function getStore(): ScanStore {
  const file = path.resolve(storeFilePath());
  const existing = stores.get(file);
  if (existing) return existing;
  const created = createStore(file);
  stores.set(file, created);
  return created;
}

export function createStore(file: string): ScanStore {
  let queue = Promise.resolve();

  const update = async <T>(mutator: (data: StoreData) => T): Promise<T> => {
    const run = queue.then(async () => {
      const data = await readData(file);
      const result = mutator(data);
      await writeData(file, data);
      return result;
    });
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const read = async <T>(reader: (data: StoreData) => T): Promise<T> => update(reader);

  return {
    listRepositories() {
      return read((data) => [...data.repositories].sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
    },
    listScans() {
      return read((data) => [...data.scans].sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
    },
    getRepository(id) {
      return read((data) => data.repositories.find((repository) => repository.id === id));
    },
    getScan(id) {
      return read((data) => data.scans.find((scan) => scan.id === id));
    },
    insertRepository(repository) {
      return update((data) => {
        data.repositories.push(repository);
        return repository;
      });
    },
    insertScan(scan) {
      return update((data) => {
        data.scans.push(scan);
        return scan;
      });
    },
    updateScan(id, patch) {
      return update((data) => {
        const scan = data.scans.find((item) => item.id === id);
        if (!scan) return undefined;
        Object.assign(scan, patch);
        return scan;
      });
    },
    transaction(mutator) {
      return update(mutator);
    },
  };
}

async function readData(file: string): Promise<StoreData> {
  try {
    const text = await readFile(file, "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.repositories) || !Array.isArray(parsed.scans)) {
      throw new Error("The local scan store is not valid JSON.");
    }
    return {
      repositories: parsed.repositories as Repository[],
      scans: parsed.scans as ScanRecord[],
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return { repositories: [], scans: [] };
    throw error;
  }
}

async function writeData(file: string, data: StoreData): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
