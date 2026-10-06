import {
  createUser as insertUser,
  findUserByIdentifier as lookupUser,
  saveRefreshToken,
  type UserRole,
} from "../models/User.model";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.util";

export async function findUserByIdentifier(identifier: string) {
  return lookupUser(identifier);
}

export async function createUser(data: {
  name: string;
  email: string;
  mobile: string;
  role?: UserRole;
}) {
  return insertUser(data);
}

export async function issueTokens(userId: string, role: "creator" | "buyer" | "admin") {
  const accessToken = generateAccessToken({ id: userId, role });
  const refreshToken = generateRefreshToken({ id: userId, role });
  await saveRefreshToken(userId, refreshToken);
  return { accessToken, refreshToken };
}