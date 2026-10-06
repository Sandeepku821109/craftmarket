import { UserModel, UserRole } from "../models/User.model";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.util";

export async function findUserByIdentifier(identifier: string) {
  const normalized = identifier.trim();
  return UserModel.findOne({
    $or: [{ email: normalized.toLowerCase() }, { mobile: normalized }],
  });
}

export async function createUser(data: {
  name: string;
  email: string;
  mobile: string;
  role?: UserRole;
}) {
  const user = await UserModel.create({
    ...data,
    email: data.email.trim().toLowerCase(),
    mobile: data.mobile.trim(),
    name: data.name.trim(),
    isVerified: true,
  });
  return user;
}

export async function issueTokens(userId: string, role: "creator" | "buyer" | "admin") {
  const accessToken = generateAccessToken({ id: userId, role });
  const refreshToken = generateRefreshToken({ id: userId, role });
  await UserModel.findByIdAndUpdate(userId, { refreshToken });
  return { accessToken, refreshToken };
}