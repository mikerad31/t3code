export type ThreadInspectionDisclosureCommand = "expand-all" | "collapse-all";

type Listener = (command: ThreadInspectionDisclosureCommand) => void;

const listenersByThreadKey = new Map<string, Set<Listener>>();

export function publishThreadDisclosureCommand(
  threadKey: string,
  command: ThreadInspectionDisclosureCommand,
): void {
  for (const listener of listenersByThreadKey.get(threadKey) ?? []) {
    listener(command);
  }
}

export function subscribeThreadDisclosureCommands(threadKey: string, listener: Listener): () => void {
  const listeners = listenersByThreadKey.get(threadKey) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByThreadKey.set(threadKey, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByThreadKey.delete(threadKey);
  };
}
