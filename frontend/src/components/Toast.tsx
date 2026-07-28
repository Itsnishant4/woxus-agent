import { useEffect, useState } from "react";

type ToastType = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let addToast: (msg: string, type?: ToastType) => void;
let idSeq = 0;

export function toast(message: string, type: ToastType = "info") {
  addToast?.(message, type);
}

export default function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    addToast = (message, type = "info") => {
      const id = ++idSeq;
      setItems((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          className={`px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg animate-in slide-in-from-right ${
            item.type === "success"
              ? "bg-green-600 text-white"
              : item.type === "error"
              ? "bg-red-600 text-white"
              : "bg-zinc-800 text-zinc-100 border border-zinc-700"
          }`}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
