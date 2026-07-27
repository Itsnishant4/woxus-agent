import mongoose, { Schema, Document } from "mongoose";

export interface IPurchase extends Document {
  email: string;
  hardwareId?: string;
  licenseKey?: string;
  amount: number;
  currency: string;
  provider: "razorpay" | "stripe" | "paypal";
  providerTxId?: string;
  razorpayOrderId?: string;
  status: "pending" | "completed" | "refunded" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const PurchaseSchema = new Schema<IPurchase>(
  {
    email: { type: String, required: true },
    hardwareId: { type: String },
    licenseKey: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    provider: { type: String, enum: ["razorpay", "stripe", "paypal"], default: "razorpay" },
    providerTxId: { type: String },
    razorpayOrderId: { type: String },
    status: {
      type: String,
      enum: ["pending", "completed", "refunded", "failed"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export const Purchase = mongoose.models.Purchase || mongoose.model<IPurchase>("Purchase", PurchaseSchema);
