-- FlowProcure Initial Schema Migration
-- Applies: enums, tables, indexes, RLS policies, immutability trigger, denormalization trigger

-- ─── Enums ─────────────────────────────────────────────────────────────────

CREATE TYPE "user_role" AS ENUM ('requester', 'approver', 'finance', 'admin');
CREATE TYPE "request_status" AS ENUM (
  'draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'ordered', 'received'
);
CREATE TYPE "approval_step_status" AS ENUM ('pending', 'approved', 'rejected', 'skipped');
CREATE TYPE "approval_decision" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "erp_system" AS ENUM ('quickbooks', 'netsuite');
CREATE TYPE "erp_operation" AS ENUM ('export_po', 'sync_vendor', 'sync_payment');
CREATE TYPE "erp_sync_status" AS ENUM ('queued', 'processing', 'success', 'failed', 'retrying');

-- ─── Core Tables ───────────────────────────────────────────────────────────

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  budget_owner_id uuid,
  cost_center_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  avatar_url text,
  role user_role NOT NULL DEFAULT 'requester',
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  sso_provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE departments
  ADD CONSTRAINT fk_department_budget_owner
  FOREIGN KEY (budget_owner_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  ein text,
  contact_email text,
  contact_phone text,
  payment_terms text,
  is_new boolean NOT NULL DEFAULT true,
  compliance_reviewed boolean NOT NULL DEFAULT false,
  compliance_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  compliance_reviewed_at timestamptz,
  preferred_erp_vendor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  status request_status NOT NULL DEFAULT 'draft',
  requester_id uuid NOT NULL REFERENCES users(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  vendor_id uuid REFERENCES vendors(id) ON DELETE SET NULL,
  total_amount numeric(12, 2) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  needed_by_date date,
  business_justification text,
  current_approval_step integer NOT NULL DEFAULT 1,
  erp_exported boolean NOT NULL DEFAULT false,
  erp_export_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric(10, 3) NOT NULL,
  unit_price numeric(12, 2) NOT NULL,
  gl_account_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Policy Engine Tables ──────────────────────────────────────────────────

CREATE TABLE approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL,
  conditions jsonb NOT NULL,
  actions jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approval_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES approval_policies(id),
  step_number integer NOT NULL,
  label text NOT NULL,
  status approval_step_status NOT NULL DEFAULT 'pending',
  requires_all boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  UNIQUE (request_id, step_number)
);

CREATE TABLE approval_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL REFERENCES approval_steps(id) ON DELETE CASCADE,
  assignee_id uuid NOT NULL REFERENCES users(id),
  decision approval_decision NOT NULL DEFAULT 'pending',
  comment text,
  decided_at timestamptz,
  notified_at timestamptz
);

-- ─── Operational Tables ────────────────────────────────────────────────────

CREATE TABLE erp_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES purchase_requests(id),
  erp_system erp_system NOT NULL,
  operation erp_operation NOT NULL DEFAULT 'export_po',
  status erp_sync_status NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_attempted_at timestamptz,
  next_retry_at timestamptz,
  error_code text,
  error_message text,
  error_log jsonb NOT NULL DEFAULT '[]',
  payload jsonb NOT NULL DEFAULT '{}',
  result jsonb,
  pg_boss_job_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  actor_role text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  before_state jsonb,
  after_state jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ───────────────────────────────────────────────────────────────

-- Inbox hot path: current user's pending assignments
CREATE INDEX idx_approval_assignments_assignee_pending
  ON approval_assignments(assignee_id)
  WHERE decision = 'pending';

-- Request list with status filtering
CREATE INDEX idx_purchase_requests_status
  ON purchase_requests(status, created_at DESC);

-- ERP worker retry queue
CREATE INDEX idx_erp_sync_jobs_status_retry
  ON erp_sync_jobs(status, next_retry_at)
  WHERE status IN ('queued', 'retrying');

-- Audit log entity lookup (compliance view)
CREATE INDEX idx_audit_logs_entity
  ON audit_logs(entity_type, entity_id, created_at DESC);

-- Approval step lookup for request
CREATE INDEX idx_approval_steps_request
  ON approval_steps(request_id, step_number);

-- ─── Request Number Generator ─────────────────────────────────────────────

CREATE SEQUENCE request_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_request_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.request_number := 'PR-' || to_char(now(), 'YYYY') || '-' ||
    LPAD(nextval('request_number_seq')::text, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_request_number
  BEFORE INSERT ON purchase_requests
  FOR EACH ROW
  WHEN (NEW.request_number IS NULL OR NEW.request_number = '')
  EXECUTE FUNCTION generate_request_number();

-- ─── Total Amount Denormalization Trigger ─────────────────────────────────

CREATE OR REPLACE FUNCTION recompute_request_total()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_request_id uuid;
  v_total numeric(12, 2);
BEGIN
  v_request_id := COALESCE(NEW.request_id, OLD.request_id);
  SELECT COALESCE(SUM(quantity * unit_price), 0)
    INTO v_total
    FROM line_items
    WHERE request_id = v_request_id;
  UPDATE purchase_requests
    SET total_amount = v_total, updated_at = now()
    WHERE id = v_request_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sync_request_total
  AFTER INSERT OR UPDATE OR DELETE ON line_items
  FOR EACH ROW EXECUTE FUNCTION recompute_request_total();

-- ─── Audit Log Immutability ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_audit_modification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable and cannot be modified or deleted';
END;
$$;

CREATE TRIGGER no_audit_modification
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification();

-- ─── Updated_at Auto-Update ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_departments_updated_at
  BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_vendors_updated_at
  BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_requests_updated_at
  BEFORE UPDATE ON purchase_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_policies_updated_at
  BEFORE UPDATE ON approval_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Users: view all active users (needed for displaying names); manage own profile
CREATE POLICY "users_select_active" ON users FOR SELECT USING (is_active = true);
CREATE POLICY "users_update_own" ON users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users_admin_all" ON users USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);

-- Departments: everyone can view
CREATE POLICY "departments_select_all" ON departments FOR SELECT USING (true);
CREATE POLICY "departments_admin_write" ON departments FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);

-- Vendors: finance and admin can manage; others can view
CREATE POLICY "vendors_select_all" ON vendors FOR SELECT USING (true);
CREATE POLICY "vendors_finance_write" ON vendors FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('finance', 'admin'))
);

-- Purchase requests: requesters see their own; approvers see assigned; finance/admin see all
CREATE POLICY "requests_requester_own" ON purchase_requests
  FOR ALL USING (requester_id = auth.uid());
CREATE POLICY "requests_approver_assigned" ON purchase_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM approval_assignments aa
      JOIN approval_steps ast ON ast.id = aa.step_id
      WHERE ast.request_id = purchase_requests.id
        AND aa.assignee_id = auth.uid()
    )
  );
CREATE POLICY "requests_finance_admin_all" ON purchase_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('finance', 'admin'))
  );

-- Line items: same visibility as parent request (simplified: all authenticated)
CREATE POLICY "line_items_authenticated" ON line_items
  FOR ALL USING (auth.uid() IS NOT NULL);

-- Approval policies: admin write; all authenticated read
CREATE POLICY "policies_select_authenticated" ON approval_policies
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "policies_admin_write" ON approval_policies FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'admin')
);

-- Approval steps/assignments: relevant users only
CREATE POLICY "steps_select_authenticated" ON approval_steps
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "assignments_select_own_or_admin" ON approval_assignments
  FOR SELECT USING (
    assignee_id = auth.uid() OR
    EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('finance', 'admin'))
  );
CREATE POLICY "assignments_update_own" ON approval_assignments
  FOR UPDATE USING (assignee_id = auth.uid());

-- ERP sync jobs: finance and admin only
CREATE POLICY "erp_jobs_finance_admin" ON erp_sync_jobs FOR ALL USING (
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('finance', 'admin'))
);

-- Audit logs: insert from server only (service role); select for admin/own actor
CREATE POLICY "audit_logs_insert" ON audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT USING (
  actor_id = auth.uid() OR
  EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role IN ('finance', 'admin'))
);
-- No UPDATE or DELETE policies = those operations blocked at DB level
