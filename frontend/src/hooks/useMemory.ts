export function useMemory() {
  return {
    memories: [],
    search: async (_q: string) => [],
    delete: async (_id: string) => {},
    export: async () => {},
  };
}
