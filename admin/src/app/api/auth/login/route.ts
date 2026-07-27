import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb/connection";
import { Admin } from "@/models/Admin";
import { verifyPassword, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) {
      return NextResponse.json({ success: false, error: "Username and password required" }, { status: 400 });
    }

    await connectDB();
    const admin = await Admin.findOne({ username });
    if (!admin || !verifyPassword(password, admin.passwordHash)) {
      return NextResponse.json({ success: false, error: "Invalid credentials" }, { status: 401 });
    }

    const token = await setSessionCookie({
      id: admin._id.toString(),
      username: admin.username,
      role: admin.role,
    });

    return NextResponse.json({ success: true, token });
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json({ success: false, error: "Server error" }, { status: 500 });
  }
}
