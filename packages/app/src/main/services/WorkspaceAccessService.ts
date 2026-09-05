import type { IpcMainInvokeEvent, WebContents } from "electron";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

type Event = Pick<IpcMainInvokeEvent, "sender" | "senderFrame">;
type Grant = { root: string; dev: number; ino: number };
type State = { grants: Map<string, Grant>; active: Grant | null; revision: number; activation: number };
export type WorkspaceLease = { root: string; assertCurrent: () => void };
const denied = () => new Error("Workspace access denied");
const within = (root: string, path: string) => {
  const value = relative(root, path);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
};

/** Grants come only from main-process native UI, never persisted renderer preferences. */
export class WorkspaceAccessService {
  private states = new WeakMap<WebContents, State>();
  constructor(
    private readonly owner: () => WebContents | null,
    private readonly confirm: (root: string) => Promise<boolean>
  ) {}

  assertSender(event: Event) {
    const owner = this.owner();
    if (!owner || owner.isDestroyed() || event?.sender !== owner || event.senderFrame !== owner.mainFrame)
      throw denied();
  }

  private state(event: Event): State {
    this.assertSender(event);
    let state = this.states.get(event.sender);
    if (!state) {
      state = { grants: new Map(), active: null, revision: 0, activation: 0 };
      this.states.set(event.sender, state);
      const clear = () => {
        state!.grants.clear();
        state!.active = null;
        state!.revision++;
        state!.activation++;
      };
      event.sender.once("destroyed", clear);
      event.sender.on("render-process-gone", clear);
      event.sender.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
        if (isMainFrame) clear();
      });
    }
    return state;
  }

  private async directory(value: string): Promise<Grant> {
    if (typeof value !== "string" || !isAbsolute(value)) throw denied();
    try {
      const root = await realpath(value);
      const info = await stat(root);
      if (!info.isDirectory()) throw denied();
      return { root, dev: info.dev, ino: info.ino };
    } catch {
      throw denied();
    }
  }

  /** Called only with the path returned by the native directory picker. */
  async grantSelection(event: Event, selected: string): Promise<string> {
    const state = this.state(event);
    const revision = state.revision;
    const grant = await this.directory(selected);
    this.assertSender(event);
    if (state.revision !== revision) throw denied();
    state.grants.set(grant.root, grant);
    return grant.root;
  }

  async activate(event: Event, value: string): Promise<boolean> {
    const state = this.state(event);
    const sequence = ++state.activation;
    if (value === "") {
      state.active = null;
      state.revision++;
      return true;
    }
    const grant = await this.directory(value);
    this.assertSender(event);
    if (sequence !== state.activation) return false;
    const known = state.grants.get(grant.root);
    if (!known || known.dev !== grant.dev || known.ino !== grant.ino) {
      if (!(await this.confirm(grant.root))) return false;
      const current = await this.directory(grant.root);
      if (current.dev !== grant.dev || current.ino !== grant.ino) throw denied();
    }
    this.assertSender(event);
    if (sequence !== state.activation) return false;
    state.grants.set(grant.root, grant);
    if (state.active?.root !== grant.root || state.active.dev !== grant.dev || state.active.ino !== grant.ino) {
      state.active = grant;
      state.revision++;
    }
    return true;
  }

  private async lease(event: Event): Promise<WorkspaceLease> {
    const state = this.state(event);
    const active = state.active;
    if (!active) throw denied();
    const revision = state.revision;
    const assertCurrent = () => {
      this.assertSender(event);
      if (state.revision !== revision || state.active !== active) throw denied();
    };
    const current = await this.directory(active.root);
    assertCurrent();
    if (current.dev !== active.dev || current.ino !== active.ino) throw denied();
    return { root: active.root, assertCurrent };
  }

  async workspace(event: Event, requested: string): Promise<WorkspaceLease> {
    const lease = await this.lease(event);
    const current = await this.directory(requested);
    lease.assertCurrent();
    if (current.root !== lease.root) throw denied();
    return lease;
  }

  async path(event: Event, requested: string): Promise<WorkspaceLease & { path: string }> {
    const lease = await this.lease(event);
    if (typeof requested !== "string" || !isAbsolute(requested)) throw denied();
    let path: string;
    try {
      path = await realpath(requested);
    } catch {
      throw denied();
    }
    lease.assertCurrent();
    if (!within(lease.root, path)) throw denied();
    return { ...lease, path };
  }
}
