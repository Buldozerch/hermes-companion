import { createContext, useContext, useState, type ReactNode } from "react";

interface CredentialsContext {
  values: Record<string, Record<string, string>>;
  update: (serverId: string, name: string, value: string) => void;
  clear: (serverId: string) => void;
}
const Context = createContext<CredentialsContext | null>(null);
const SavedContext = createContext<Set<string>>(new Set());
export function SavedCredentialsProvider({
  configured,
  children,
}: {
  configured: Set<string>;
  children: ReactNode;
}) {
  return <SavedContext.Provider value={configured}>{children}</SavedContext.Provider>;
}
export function useSavedCredential(name: string) {
  return useContext(SavedContext).has(name);
}
export function useSavedCredentials() {
  return useContext(SavedContext);
}

// Connection credentials stay in memory and are never part of a settings draft.
export function SetupCredentialsProvider({ children }: { children: ReactNode }) {
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  return (
    <Context.Provider
      value={{
        values,
        update: (id, name, value) =>
          setValues((previous) => ({ ...previous, [id]: { ...previous[id], [name]: value } })),
        clear: (id) =>
          setValues((previous) => {
            const next = { ...previous };
            delete next[id];
            return next;
          }),
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useSetupCredentials(serverId: string) {
  const context = useContext(Context);
  if (!context) throw new Error("SetupCredentialsProvider is missing.");
  return {
    values: context.values[serverId] ?? {},
    update: (name: string, value: string) => context.update(serverId, name, value),
    clear: () => context.clear(serverId),
  };
}
