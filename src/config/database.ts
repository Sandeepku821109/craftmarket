import mongoose from "mongoose";
import { ENV } from "./env";

export async function connectDB() {
  await mongoose.connect(ENV.MONGO_URI);
  console.log("MongoDB connected");
}