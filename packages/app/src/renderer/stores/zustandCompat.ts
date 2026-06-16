import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

type AnyRecord = Record<string, any>;
type StateFactory<TState extends AnyRecord> = () => TState;
type GetterFactory<TState extends AnyRecord> = (state: TState & AnyRecord) => any;
type ActionFactory<TState extends AnyRecord> = (this: TState & AnyRecord, ...args: any[]) => any;

type DefineStoreOptions<TState extends AnyRecord> = {
  state: StateFactory<TState>;
  getters?: Record<string, any>;
  actions?: Record<string, ActionFactory<TState>>;
};

type CompatStoreHook<TStore extends AnyRecord> = {
  <TSelected>(selector: (store: TStore) => TSelected): TSelected;
  (): TStore;
  (_ignored: unknown): TStore;
  getState(): TStore;
  setState(partial: Partial<TStore> | ((state: TStore) => Partial<TStore>), replace?: boolean): void;
  subscribe: StoreApi<TStore>["subscribe"];
};

function bindGetters<TStore extends AnyRecord>(
  target: TStore,
  getters: Record<string, GetterFactory<any>> | undefined
): TStore {
  if (!getters) return target;
  for (const [key, getter] of Object.entries(getters)) {
    if (Object.prototype.hasOwnProperty.call(target, key)) continue;
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: true,
      get() {
        return getter.call(target, target);
      },
    });
  }
  return target;
}

function cloneStoreState<TStore extends AnyRecord>(
  source: TStore,
  getters: Record<string, GetterFactory<any>> | undefined
): TStore {
  const getterKeys = new Set(Object.keys(getters ?? {}));
  const next: AnyRecord = {};
  for (const [key, value] of Object.entries(source)) {
    if (getterKeys.has(key)) continue;
    next[key] = value;
  }
  return bindGetters(next as TStore, getters);
}

function isObjectRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object";
}

export function defineStore<TState extends AnyRecord>(
  _id: string,
  options: DefineStoreOptions<TState>
): CompatStoreHook<any> {
  type TStore = TState & AnyRecord;

  const initialState = bindGetters({ ...options.state() } as TStore, options.getters);
  let api!: StoreApi<TStore>;
  let actionDepth = 0;

  const publishIfOuterAction = () => {
    if (actionDepth !== 0) return;
    api.setState(cloneStoreState(api.getState(), options.getters), true);
  };

  const setCompatState = (partial: Partial<TStore> | ((state: TStore) => Partial<TStore>), replace?: boolean) => {
    const current = api.getState();
    const patch = typeof partial === "function" ? partial(current) : partial;
    if (!isObjectRecord(patch)) return;
    const next = replace ? bindGetters({ ...(patch as AnyRecord) } as TStore, options.getters) : cloneStoreState(current, options.getters);
    if (!replace) Object.assign(next as AnyRecord, patch);
    api.setState(next, true);
  };

  const actions = options.actions ?? {};
  for (const [key, action] of Object.entries(actions)) {
    (initialState as AnyRecord)[key] = (...args: any[]) => {
      const store = api.getState();
      actionDepth += 1;
      try {
        const result = action.apply(store, args);

        if (result && typeof result.then === "function") {
          return result.finally(() => {
            actionDepth -= 1;
            publishIfOuterAction();
          });
        }

        actionDepth -= 1;
        publishIfOuterAction();
        return result;
      } catch (error) {
        actionDepth -= 1;
        publishIfOuterAction();
        throw error;
      }
    };
  }

  api = createStore<TStore>(() => initialState);

  const liveStore = new Proxy({} as TStore, {
    get(_target, prop) {
      return Reflect.get(api.getState(), prop);
    },
    set(_target, prop, value) {
      if (typeof prop !== "string") return false;
      setCompatState({ [prop]: value } as Partial<TStore>);
      return true;
    },
    deleteProperty(_target, prop) {
      const next = cloneStoreState(api.getState(), options.getters) as AnyRecord;
      delete next[prop as keyof AnyRecord];
      api.setState(bindGetters(next as TStore, options.getters), true);
      return true;
    },
    has(_target, prop) {
      return prop in api.getState();
    },
    ownKeys() {
      return Reflect.ownKeys(api.getState());
    },
    getOwnPropertyDescriptor(_target, prop) {
      const descriptor = Object.getOwnPropertyDescriptor(api.getState(), prop);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });

  const useCompatStore = (function (arg?: unknown) {
    if (typeof arg === "function") {
      return useStore(api, arg as (store: TStore) => unknown);
    }
    if (arguments.length > 0) return liveStore;
    try {
      return useStore(api, (store) => store);
    } catch {
      return api.getState();
    }
  }) as CompatStoreHook<TStore>;

  useCompatStore.getState = api.getState;
  useCompatStore.setState = setCompatState;
  useCompatStore.subscribe = api.subscribe;
  return useCompatStore;
}
