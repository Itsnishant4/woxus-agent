import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  hardwareId: string;
  deviceInfo?: string;
  blocked: boolean;
  blockedAt?: Date;
  trialStartedAt?: Date;
  trialDurationSeconds: number;
  trialActive: boolean;
  totalSessions: number;
  lastActiveAt?: Date;
  licenseKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    hardwareId: { type: String, required: true, unique: true, index: true },
    deviceInfo: { type: String },
    blocked: { type: Boolean, default: false },
    blockedAt: { type: Date },
    trialStartedAt: { type: Date },
    trialDurationSeconds: { type: Number, default: 600 },
    trialActive: { type: Boolean, default: false },
    totalSessions: { type: Number, default: 0 },
    lastActiveAt: { type: Date },
    licenseKey: { type: String },
  },
  { timestamps: true }
);

export const User = mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
