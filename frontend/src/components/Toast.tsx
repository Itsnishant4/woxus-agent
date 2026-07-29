import { toast as hotToast, Toaster } from "react-hot-toast";

type ToastType = "success" | "error" | "info";

export function toast(message: string, type: ToastType = "info") {
  if (type === "success") hotToast.success(message);
  else if (type === "error") hotToast.error(message);
  else hotToast(message, { style: { background: "#27272a", color: "#f4f4f5", border: "1px solid #3f3f46" } });
}

export { Toaster };
export default Toaster;
