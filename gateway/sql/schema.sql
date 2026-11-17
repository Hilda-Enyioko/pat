create table if not exists enrollments (
  id bigserial primary key,
  phone text not null unique,
  owner text not null,
  reservation text not null unique,
  mint text not null,
  decimals smallint not null,
  symbol text not null default 'USDC',
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists payments (
  id bigserial primary key,
  session_id text not null unique,
  payment_id bytea not null unique,
  enrollment_id bigint not null references enrollments(id),
  merchant_code int not null,
  amount numeric(40,0) not null,
  status text not null default 'pending'
    check (status in ('pending','sending','settled','failed')),
  signature text,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_status_idx on payments(status);

-- Merchant codes are 10 digits (1000000000..4294967295, the top of the program's u32).
alter table payments alter column merchant_code type bigint;

-- Phone linking from the PWA. The app shows a 6-digit link code; the user dials the
-- USSD service code from that phone and enters it. That proves the phone. The wallet
-- is proven later by the reserve transaction (memo) or a signed message.
create table if not exists enroll_links (
  id text primary key,
  phone text not null,
  owner text not null,
  code_hash text not null,
  attempts int not null default 0,
  verified_at timestamptz,
  used boolean not null default false,
  ip text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists enroll_links_phone_idx on enroll_links(phone, created_at);

-- Old SMS-OTP enrollment, replaced by enroll_links.
drop table if exists enroll_challenges;

-- One USSD merchant code per wallet. 'reserved' is free (database only);
-- 'active' means register_merchant ran on-chain with payout = wallet.
create table if not exists merchant_codes (
  wallet text primary key,
  code bigint not null unique check (code between 1000000000 and 4294967295),
  status text not null default 'reserved' check (status in ('reserved','active')),
  signature text,
  ip text,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);
