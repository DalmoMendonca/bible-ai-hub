declare const control: {
  configure(options: {appId: string; environment?: string}): typeof control;
  fetch(role: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  fetchWith<T extends (...args: never[]) => unknown>(role: string, fetcher: T, ...args: Parameters<T>): Promise<Awaited<ReturnType<T>>>;
  client<T extends object>(role: string, owner: T): T;
  axios<T extends object>(role: string, owner: T): T;
  wrap<T extends (...args: any[]) => any>(handler: T): T;
  nodeRequest(role: string, client: typeof import('node:https'), options: import('node:https').RequestOptions | string | URL, callback: (response: import('node:http').IncomingMessage) => void): import('node:http').ClientRequest;
  flush(): Promise<void>;
  status(event?: unknown): Promise<{version: number; app_id: string; environment: string; revision: string | null; storage_verified: boolean; ready: boolean; capabilities: string[]}>;
};
export = control;
