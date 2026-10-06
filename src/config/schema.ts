export const DATABASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id varchar(24) PRIMARY KEY DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  name text NOT NULL,
  email varchar(254) NOT NULL UNIQUE,
  mobile varchar(25) NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'buyer' CHECK (role IN ('creator', 'buyer', 'admin')),
  is_verified boolean NOT NULL DEFAULT false,
  avatar text,
  uploaded_software text[] NOT NULL DEFAULT '{}',
  purchased_software text[] NOT NULL DEFAULT '{}',
  total_earnings numeric NOT NULL DEFAULT 0,
  refresh_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS software (
  id varchar(24) PRIMARY KEY DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  title text NOT NULL,
  description text NOT NULL,
  creator_id varchar(24) NOT NULL REFERENCES users(id),
  images text[] NOT NULL CHECK (cardinality(images) >= 2),
  video text NOT NULL,
  live_demo_url text CHECK (live_demo_url IS NULL OR live_demo_url LIKE 'https://%'),
  pdf_document text,
  github_username text NOT NULL,
  git_repository text NOT NULL,
  languages text[] NOT NULL DEFAULT '{}',
  platform_type text NOT NULL CHECK (platform_type IN ('frontend', 'backend', 'fullstack', 'mobile-app')),
  price numeric NOT NULL CHECK (price > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  total_sales integer NOT NULL DEFAULT 0,
  total_revenue numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id varchar(24) PRIMARY KEY DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  buyer_id varchar(24) NOT NULL REFERENCES users(id),
  software_id varchar(24) NOT NULL REFERENCES software(id),
  creator_id varchar(24) NOT NULL REFERENCES users(id),
  amount numeric NOT NULL,
  platform_fee numeric NOT NULL,
  creator_earning numeric NOT NULL,
  razorpay_order_id text NOT NULL,
  razorpay_payment_id text,
  razorpay_signature text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  paid_at timestamptz,
  access_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS earnings (
  id varchar(24) PRIMARY KEY DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  order_id varchar(24) NOT NULL UNIQUE REFERENCES orders(id),
  buyer_id varchar(24) NOT NULL REFERENCES users(id),
  creator_id varchar(24) NOT NULL REFERENCES users(id),
  software_id varchar(24) NOT NULL REFERENCES software(id),
  amount numeric NOT NULL CHECK (amount >= 0),
  platform_fee numeric NOT NULL CHECK (platform_fee >= 0),
  creator_earning numeric NOT NULL CHECK (creator_earning >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otps (
  id varchar(24) PRIMARY KEY DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  identifier text NOT NULL,
  otp text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('signup', 'login')),
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  UNIQUE (identifier, purpose)
);

CREATE TABLE IF NOT EXISTS contact_submissions (
  id varchar(24) PRIMARY KEY DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  name varchar(100) NOT NULL,
  phone varchar(25) NOT NULL,
  email varchar(254) NOT NULL,
  subject text NOT NULL CHECK (subject IN ('General question', 'Buying a product', 'Selling on Craftmarket', 'Report a problem', 'Something else')),
  query text NOT NULL CHECK (length(query) BETWEEN 10 AND 5000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in-progress', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS software_creator_created_idx ON software(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS software_status_created_idx ON software(status, created_at DESC);
CREATE INDEX IF NOT EXISTS software_languages_idx ON software USING gin(languages);
CREATE INDEX IF NOT EXISTS orders_buyer_status_idx ON orders(buyer_id, status);
CREATE INDEX IF NOT EXISTS orders_creator_status_idx ON orders(creator_id, status);
CREATE INDEX IF NOT EXISTS earnings_creator_created_idx ON earnings(creator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS otps_expiry_idx ON otps(expires_at);
CREATE INDEX IF NOT EXISTS contact_submissions_created_idx ON contact_submissions(created_at DESC);
`;
