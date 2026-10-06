import Razorpay from "razorpay";
import { ENV } from "./env";

export const razorpayInstance = new Razorpay({
  key_id: ENV.RAZORPAY_KEY_ID,
  key_secret: ENV.RAZORPAY_KEY_SECRET,
});