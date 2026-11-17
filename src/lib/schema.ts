export const MIGRATION_003: string[] = [
  `create table if not exists rondas (
    id text primary key,
    session_key text not null unique,
    label text not null,
    symbol text not null,
    status text not null,
    vote_opens_at bigint not null,
    starts_at bigint not null,
    ends_at bigint not null,
    entry_price text,
    stop_pct text,
    target_pct text,
    source text,
    resolution text,
    resolution_note text,
    resolved_at bigint,
    created_at bigint not null
  )`,
  `create table if not exists ronda_picks (
    id text primary key,
    ronda_id text not null,
    actor_type text not null,
    actor_id text not null,
    display_name text not null,
    side text not null,
    rationale text,
    entry_price text,
    stop_price text,
    target_price text,
    points text,
    outcome text,
    hash text,
    created_at bigint not null,
    updated_at bigint not null,
    unique (ronda_id, actor_type, actor_id)
  )`,
  `create table if not exists proof_chain (
    id text primary key,
    seq integer not null unique,
    prev_hash text not null,
    hash text not null unique,
    canonical text not null,
    kind text not null,
    ref_id text not null,
    created_at bigint not null
  )`,
  `create index if not exists idx_proof_chain_time on proof_chain(seq)`,
  `create table if not exists free_calls (
    id text primary key,
    user_id text not null,
    symbol text not null,
    side text not null,
    entry_price text not null,
    stop_price text not null,
    target_price text not null,
    horizon text not null,
    starts_at bigint not null,
    ends_at bigint not null,
    status text not null,
    source text,
    resolution text,
    points text,
    note text,
    hash text not null,
    created_at bigint not null,
    resolved_at bigint
  )`,
  `create table if not exists month_poll (
    user_id text not null,
    month_key text not null,
    choice text not null,
    created_at bigint not null,
    primary key (user_id, month_key)
  )`,
  `create table if not exists sentiment_cache (
    id text primary key,
    value integer,
    label text,
    source text not null,
    fetched_at bigint not null,
    status text not null,
    detail text
  )`,
  `create table if not exists daily_briefs (
    day_key text primary key,
    body text not null,
    source text not null,
    created_at bigint not null
  )`,
  `alter table oauth_states add column if not exists code_verifier text`,
];

export const MIGRATION_004: string[] = [
  `alter table user_settings add column if not exists theme text not null default 'dark'`,
  `alter table user_settings add column if not exists favorites text not null default ''`,
  `alter table user_settings add column if not exists tutorial_done integer not null default 0`,
];

export const MIGRATION_002: string[] = [
  `create table if not exists ai_provider_state (
    provider text primary key,
    cooldown_until bigint not null default 0,
    consecutive_failures integer not null default 0,
    last_error text,
    last_ok_at bigint,
    updated_at bigint not null
  )`,
  `create table if not exists ai_memory (
    user_id text primary key,
    summary text not null,
    updated_at bigint not null
  )`,
];

export const SCHEMA: string[] = [
  `create table if not exists users (
    id text primary key,
    email text not null unique,
    username text not null unique,
    password_hash text,
    role text not null,
    google_sub text unique,
    avatar_hue integer not null,
    disabled integer not null default 0,
    created_at bigint not null
  )`,
  `create table if not exists sessions (
    token_hash text primary key,
    user_id text not null,
    expires_at bigint not null,
    created_at bigint not null,
    user_agent text,
    ip text
  )`,
  `create table if not exists invites (
    id text primary key,
    code_hash text not null unique,
    created_by text not null,
    max_uses integer not null,
    uses integer not null default 0,
    expires_at bigint,
    note text,
    created_at bigint not null
  )`,
  `create table if not exists password_resets (
    id text primary key,
    user_id text not null,
    token_hash text not null,
    expires_at bigint not null,
    used_at bigint,
    created_at bigint not null
  )`,
  `create table if not exists google_allowlist (
    email text primary key,
    created_by text,
    created_at bigint not null
  )`,
  `create table if not exists oauth_states (
    state_hash text primary key,
    invite_code text,
    next_path text,
    expires_at bigint not null,
    created_at bigint not null
  )`,
  `create table if not exists accounts (
    id text primary key,
    owner_type text not null,
    owner_id text not null,
    label text not null,
    initial_balance text not null,
    balance text not null,
    status text not null,
    is_demo integer not null default 0,
    created_at bigint not null,
    last_processed_at bigint,
    last_funding_hour bigint,
    catchup_note text
  )`,
  `create table if not exists ledger (
    id text primary key,
    account_id text not null,
    type text not null,
    amount text not null,
    balance_after text not null,
    ref_id text,
    note text,
    created_at bigint not null
  )`,
  `create table if not exists positions (
    id text primary key,
    account_id text not null,
    symbol text not null,
    side text not null,
    status text not null,
    qty text not null,
    entry_price text not null,
    margin text not null,
    leverage integer not null,
    realized_pnl text not null,
    fees text not null,
    funding text not null,
    tp text,
    sl text,
    opened_at bigint not null,
    closed_at bigint,
    close_price text,
    close_reason text,
    last_mark text,
    last_mark_at bigint,
    last_mark_source text
  )`,
  `create table if not exists orders (
    id text primary key,
    account_id text not null,
    symbol text not null,
    side text not null,
    intent text not null,
    type text not null,
    status text not null,
    margin text,
    leverage integer,
    qty text,
    limit_price text,
    stop_price text,
    position_id text,
    created_at bigint not null,
    updated_at bigint not null,
    filled_at bigint,
    fill_price text,
    note text
  )`,
  `create table if not exists trades (
    id text primary key,
    account_id text not null,
    position_id text not null,
    symbol text not null,
    side text not null,
    leverage integer not null,
    qty text not null,
    entry_price text not null,
    exit_price text not null,
    realized_pnl text not null,
    fee text not null,
    reason text not null,
    opened_at bigint not null,
    closed_at bigint not null
  )`,
  `create table if not exists quotes (
    symbol text primary key,
    price text not null,
    change_value text,
    change_basis text,
    volume text,
    source text not null,
    provider_ts bigint,
    fetched_at bigint not null,
    executable integer not null,
    status text not null,
    detail text
  )`,
  `create table if not exists funding_rates (
    symbol text primary key,
    rate text,
    source text,
    fetched_at bigint,
    status text not null,
    detail text
  )`,
  `create table if not exists candles (
    symbol text not null,
    interval text not null,
    ts bigint not null,
    open text not null,
    high text not null,
    low text not null,
    close text not null,
    volume text,
    source text not null,
    primary key (symbol, interval, ts)
  )`,
  `create table if not exists data_gaps (
    id text primary key,
    account_id text,
    symbol text,
    from_ts bigint not null,
    to_ts bigint not null,
    reason text not null,
    created_at bigint not null
  )`,
  `create table if not exists equity_snapshots (
    account_id text not null,
    ts bigint not null,
    equity text not null,
    balance text not null,
    primary key (account_id, ts)
  )`,
  `create table if not exists battles (
    id text primary key,
    symbol text not null,
    status text not null,
    vote_starts_at bigint not null,
    vote_ends_at bigint not null,
    ends_at bigint not null,
    reward_pct text not null,
    risk_pct text not null,
    start_price text,
    end_price text,
    high_price text,
    low_price text,
    source text,
    resolved_at bigint,
    resolution text,
    resolution_note text,
    created_by text,
    created_at bigint not null
  )`,
  `create table if not exists battle_votes (
    battle_id text not null,
    user_id text not null,
    direction text not null,
    created_at bigint not null,
    updated_at bigint not null,
    primary key (battle_id, user_id)
  )`,
  `create table if not exists battle_scores (
    battle_id text not null,
    user_id text not null,
    points integer not null,
    correct integer,
    reason text not null,
    detail_json text not null,
    primary key (battle_id, user_id)
  )`,
  `create table if not exists agents (
    id text primary key,
    slug text not null unique,
    name text not null,
    kind text not null,
    provider text,
    description text not null,
    account_id text
  )`,
  `create table if not exists arena_runs (
    id text primary key,
    created_by text,
    symbol text not null,
    mode text not null,
    price text not null,
    price_source text not null,
    price_ts bigint not null,
    context_json text not null,
    created_at bigint not null
  )`,
  `create table if not exists agent_decisions (
    id text primary key,
    run_id text not null,
    agent_id text not null,
    symbol text not null,
    price text not null,
    action text not null,
    confidence text,
    risk text,
    tp text,
    sl text,
    rationale text not null,
    provider text,
    model text,
    created_at bigint not null,
    executed integer not null default 0,
    execution_note text,
    self_reported integer not null default 0
  )`,
  `create table if not exists ai_usage (
    id text primary key,
    user_id text,
    provider text not null,
    model text not null,
    task text not null,
    prompt_tokens integer,
    completion_tokens integer,
    estimated_cost text,
    latency_ms integer,
    cached integer not null default 0,
    ok integer not null,
    error text,
    created_at bigint not null
  )`,
  `create table if not exists ai_cache (
    cache_key text primary key,
    task text not null,
    response text not null,
    created_at bigint not null,
    expires_at bigint not null
  )`,
  `create table if not exists ai_budget (
    id integer primary key,
    daily_usd text not null,
    monthly_usd text not null
  )`,
  `create table if not exists notifications (
    id text primary key,
    user_id text not null,
    category text not null,
    title text not null,
    body text not null,
    read_at bigint,
    created_at bigint not null
  )`,
  `create table if not exists notification_prefs (
    user_id text not null,
    category text not null,
    enabled integer not null default 1,
    primary key (user_id, category)
  )`,
  `create table if not exists alerts (
    id text primary key,
    user_id text not null,
    symbol text not null,
    kind text not null,
    threshold text not null,
    enabled integer not null default 1,
    last_fired_at bigint,
    created_at bigint not null
  )`,
  `create table if not exists user_settings (
    user_id text primary key,
    reduce_motion integer not null default 0,
    alert_move_pct text not null default '3',
    autonomous_enabled integer not null default 0,
    autonomous_max_margin text not null default '10',
    autonomous_max_leverage integer not null default 2,
    autonomous_symbols text not null default 'BTC'
  )`,
  `create table if not exists conversations (
    id text primary key,
    user_id text not null,
    kind text not null,
    title text not null,
    created_at bigint not null
  )`,
  `create table if not exists messages (
    id text primary key,
    conversation_id text not null,
    role text not null,
    content text not null,
    meta text,
    created_at bigint not null
  )`,
  `create table if not exists system_events (
    id text primary key,
    level text not null,
    source text not null,
    message text not null,
    meta text,
    created_at bigint not null
  )`,
  `create table if not exists rate_limits (
    key text primary key,
    window_start bigint not null,
    count integer not null
  )`,
  `create table if not exists pulse_lock (
    id integer primary key,
    locked_until bigint not null,
    last_run_at bigint,
    last_error text
  )`,
  `create index if not exists idx_sessions_user on sessions(user_id)`,
  `create index if not exists idx_positions_account on positions(account_id, status)`,
  `create index if not exists idx_trades_account on trades(account_id, closed_at)`,
  `create index if not exists idx_notifications_user on notifications(user_id, created_at)`,
  `create index if not exists idx_candles_lookup on candles(symbol, interval, ts)`,
  `insert into pulse_lock (id, locked_until) values (1, 0) on conflict (id) do nothing`,
  `insert into ai_budget (id, daily_usd, monthly_usd) values (1, '1', '10') on conflict (id) do nothing`,
];
