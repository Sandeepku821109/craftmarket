export function configureTestEnvironment(): void {
  process.env.NODE_ENV = "test";
  process.env.MONGO_URI = "mongodb://127.0.0.1:27017/marketplace_test";
  process.env.JWT_ACCESS_SECRET = "test-access-secret-not-used-outside-tests";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret-not-used-outside-tests";
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-api-key";
  process.env.CLOUDINARY_API_SECRET = "test-api-secret";
  process.env.RAZORPAY_KEY_ID = "rzp_test_unused";
  process.env.RAZORPAY_KEY_SECRET = "test-razorpay-secret";
  process.env.SMTP_HOST = "localhost";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "test@example.invalid";
  process.env.SMTP_PASS = "test-smtp-password";
  process.env.CORS_ORIGINS = "http://localhost:3000";
  process.env.REDIS_URL = "";
  process.env.RABBITMQ_URL = "";
  process.env.COOKIE_DOMAIN = "";
}
