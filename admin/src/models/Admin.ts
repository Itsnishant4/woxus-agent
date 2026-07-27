import mongoose, { Schema, Document } from "mongoose";

export interface IAdmin extends Document {
  username: string;
  passwordHash: string;
  role: "superadmin" | "admin";
  createdAt: Date;
  updatedAt: Date;
}

const AdminSchema = new Schema<IAdmin>(
  {
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["superadmin", "admin"], default: "admin" },
  },
  { timestamps: true }
);

export const Admin = mongoose.models.Admin || mongoose.model<IAdmin>("Admin", AdminSchema);
