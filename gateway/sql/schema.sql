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
