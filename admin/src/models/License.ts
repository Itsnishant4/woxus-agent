import mongoose, { Schema, Document } from "mongoose";

export interface ILicense extends Document {
  key: string;
  hardwareId?: string;
  hardwareIds: string[];
  expiry: Date | null;
  features: string[];
  revoked: boolean;
  revokedAt?: Date;
  maxActivations: number;
  activationCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const LicenseSchema = new Schema<ILicense>(
  {
    key: { type: String, required: true, unique: true, index: true },
    hardwareId: { type: String },
    hardwareIds: [{ type: String }],
    expiry: { type: Date, default: null },
    features: [{ type: String }],
    revoked: { type: Boolean, default: false },
    revokedAt: { type: Date },
    maxActivations: { type: Number, default: 3 },
    activationCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const License = mongoose.models.License || mongoose.model<ILicense>("License", LicenseSchema);
