export function useMemory() {
  return {
    memories: [],
    search: async (q: string) => [],
    delete: async (id: string) => {},
    export: async () => {},
  };
}
