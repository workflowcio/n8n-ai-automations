# CHATAIPilot Handover — 2026-10-24

**Product decision (David, 2026-10-24):** ChatbotAI is NOT merged into Websitebuilder. It becomes a standalone Pilot named **CHATAIPilot** in the `workflowcio/workflowcio` repo, following the same standards as other Pilots, sellable alone with industry add-on packs. Websitebuilder calls it as an agent or skill.

**Source sessions:** `workflowcio/n8n-ai-automations` — branch `claude/wordpress-ai-agent-supabase-GDsYH` and other `claude/*` branches (all downloaded as `all-branches-export.zip` by David, 2026-06-14).

---

## 1. Product Identity

| Field | Value |
|-------|-------|
| Plugin slug | `wordpress-ai-agent` |
| Working names | ChatbotAI, ChatAI Agent, WP AI Agent |
| Pilot name | CHATAIPilot |
| License | GPL-2.0 (plugin) + commercial add-on packs via Gumroad |
| Minimum PHP | 8.1 |
| Architecture | WordPress plugin (PSR-4, singleton bootstrap) + Supabase (PostgreSQL + pgvector) |
| LLM architecture | BYOLLM — user brings their own API keys |

---

## 2. Features Built (v1.0)

### Core Engine
- **Streaming AI chat widget** — Server-Sent Events (SSE) via PHP cURL; vanilla JS IIFE frontend; no React dependency
- **BYOLLM provider adapter** (`class-llm-provider.php`, 948 LOC) — supports Anthropic, OpenAI, Gemini, Azure OpenAI, Groq, Ollama, custom endpoints; unified tool-call format translated per provider at runtime
- **AI engine with tool orchestration** (`class-ai-engine.php`, 750 LOC) — streaming + tool orchestration; Anthropic prompt caching (3 static blocks + 1 dynamic)
- **RAG knowledge base** (`class-knowledge-base.php`, 642 LOC) — PDF/DOCX/TXT/MD/HTML/WP posts/URLs ingestion; smart chunking; async embedding via Supabase Edge Function; cosine similarity retrieval via pgvector

### Conversation & Sessions
- **Conversation manager** (`class-conversation-manager.php`, 291 LOC) — multi-turn context; session persistence; returning customer recognition (3-signal: WP user > email > browser fingerprint hash)

### Lead Capture & CRM
- **Lead capture** (`class-lead-capture.php`, 427 LOC) — intent detection; 0–100 progressive scoring; CRM webhook delivery (fire-and-forget — no retry; see open bugs)
- **Contact manager / agent routing** (`class-contact-manager.php`, 403 LOC) — returning client → user selection → round-robin → senior admin fallback; availability states; email transcript delivery with threading (Message-ID/In-Reply-To)

### Compliance & Safety
- **Guard rails** (`class-guard-rails.php`, 319 LOC) — anti-slop; PII detection/redaction; prompt injection prevention; quality scoring; crisis detection Tier 1 + Tier 2 (988 Lifeline — non-bypassable by config or LLM)

### Security
- **Security layer** (`class-security.php`, 375 LOC) — token bucket rate limiting; input sanitization; file upload validation (polyglot bypass gap — see open bugs); AES-256-CBC encryption for secrets at rest

### Licensing
- **License manager** (`class-license-manager.php`, 292 LOC) — Gumroad API verify; HMAC webhook; seat enforcement; per-pack gating

### Admin
- **Settings UI** — 12 sections; React SPA (agents page); PHP+vanilla JS (license page, agents management)
- **17 planned packs** in license UI: mortgage, real_estate, recruiting, hvac, roofing, plumbing, electrical, solar, contracting, landscaping, auto_dealer, auto_repair, legal, medical, dental, insurance_home_auto, financial_planning

### Industry Pack System
- **Abstract base class** (`class-industry-pack-base.php`, 4,080 LOC) — required contract: `get_id()`, `get_name()`, `get_description()`, `get_system_prompt()`, `get_tool_definitions()`, `execute_tool()`, `get_lifecycle_stages()`, `get_qualification_schema()`, `get_compliance_instructions()`, `get_suggested_questions()`
- **Pack registry** (`class-industry-pack-registry.php`, 120 LOC) — discovers and loads all packs

### Integration Templates
- n8n workflow JSON (`automation/n8n-workflow.json`)
- Zapier workflow JSON (`automation/zapier-workflow.json`)
- Make.com scenario JSON (`automation/make-scenario.json`)

### Accessibility
- WCAG 2.1 AA (ARIA live regions, focus trap, keyboard navigation)

---

## 3. Industry Add-On Packs (Built)

| Pack | ID | Status | Key Tools | Compliance |
|------|----|--------|-----------|------------|
| Mortgage | `mortgage` | **Complete** | DTI/LTV/PMI calc, amortization, doc checklist, eligibility, appointment, regulatory search | RESPA, TILA, ECOA, HMDA; ECOA disclaimer hardcoded in assess_eligibility |
| Real Estate | `real_estate` | **Complete** | Buyer/seller profile capture, transaction checklist (stage-aware, condo/HOA, first-time buyer), consultation scheduling, regulatory search | Fair Housing, HUD/NAR/CFPB/FTC |
| Recruiting | `recruiting` | **Complete** | Candidate profile capture, position details (KB-backed), interview scheduling | EEOC, ADA |
| Legal | `legal` | **Complete** | Matter intake, conflict check logging, consultation scheduling | No-legal-advice guardrail, SOL urgency flag, emergency protocol |
| Medical | `medical` | **Complete** | Patient inquiry capture, agent routing | HIPAA-aware (no clinical detail, no PHI), emergency protocol (9 categories → 911), 988 Lifeline |
| Dental | `dental` | **Complete** | Service triage, dental emergency (knocked-out tooth), inquiry capture | HIPAA-aware |
| Insurance | `insurance_home_auto` | **Complete** | DIME calculator, Medicare overview (A/B/C/D, Medigap, enrollment windows), needs analysis, inquiry capture | CMS, HIPAA, suitability guardrails |

**Packs planned but not yet built:** HVAC, roofing, plumbing, electrical, solar, contracting, landscaping, auto dealer, auto repair, financial planning (10 packs)

---

## 4. Architecture

```
WordPress Site
└── wordpress-ai-agent/ (plugin)
    ├── includes/
    │   ├── class-plugin.php          # Bootstrap singleton
    │   ├── class-ai-engine.php       # LLM streaming + tool orchestration
    │   ├── class-llm-provider.php    # BYOLLM adapter (7 providers)
    │   ├── class-knowledge-base.php  # RAG: ingest, chunk, embed, retrieve
    │   ├── class-rest-api.php        # All REST endpoints
    │   ├── class-guard-rails.php     # Safety + compliance
    │   ├── class-supabase-client.php # pgvector queries + RLS
    │   ├── class-conversation-manager.php
    │   ├── class-lead-capture.php
    │   ├── class-contact-manager.php
    │   ├── class-security.php
    │   ├── class-settings.php
    │   ├── class-license-manager.php
    │   ├── class-industry-pack-registry.php
    │   ├── class-installer.php
    │   ├── admin/
    │   │   ├── class-admin.php
    │   │   └── views/ (agents.php, license.php, ...)
    │   └── industry-packs/
    │       ├── class-industry-pack-base.php  # Abstract base (4,080 LOC)
    │       ├── class-mortgage-pack.php
    │       ├── class-real-estate-pack.php
    │       ├── class-recruiting-pack.php
    │       ├── class-legal-pack.php
    │       ├── class-medical-pack.php
    │       ├── class-dental-pack.php
    │       └── class-insurance-pack.php
    ├── assets/
    │   ├── chat-widget.js   # Vanilla JS IIFE (~1,200+ LOC)
    │   └── chat-widget.css  # WCAG 2.1 AA; CSS custom properties; dark mode
    ├── supabase/
    │   └── migrations/
    │       ├── 001_initial_schema.sql   # Tables + vector search functions
    │       ├── 002_rls_policies.sql     # Row-level security
    │       ├── 003_contact_management.sql  # Agents + routing stored functions
    │       └── 004_agents_application_url.sql
    └── automation/
        ├── n8n-workflow.json
        ├── zapier-workflow.json
        └── make-scenario.json
```

**Supabase tables:** agent_sessions, agent_messages, kb_documents, kb_chunks (vector(1536) IVFFlat), agent_leads, agent_analytics, rate_limit_buckets, agent_feedback, industry_pack_configs, agents, agent_availability_log, agent_session_assignments, email_notification_log

**Embedding:** text-embedding-3-small (1536 dim); async trigger via Supabase Edge Function (Deno/TypeScript)

---

## 5. Data Collected From Visitors

| Data | Table | Retention Default | Required Minimum |
|------|-------|-------------------|------------------|
| Session token (hashed) | agent_sessions | 90 days (BUG — see below) | 780 days (ECOA/Reg Z) |
| Chat messages | agent_messages | 90 days (BUG) | 780 days (ECOA/Reg Z) |
| Lead: name, email, phone, intent score | agent_leads | 90 days (BUG) | 780 days (ECOA/Reg Z) |
| Document chunks + embeddings | kb_chunks | Indefinite | N/A |
| Analytics events | agent_analytics | 90 days | Configurable |
| Rate limit buckets | rate_limit_buckets | Session | N/A |
| Agent feedback | agent_feedback | 90 days | N/A |
| Browser fingerprint hash (not raw) | agent_sessions | 90 days | N/A |

**CRITICAL:** `cleanup_expired_data(retention_days INT DEFAULT 90)` — the DEFAULT must be changed to 780 for mortgage/real estate packs to satisfy ECOA/Reg Z 25-month retention requirement.

---

## 6. Hosting & External Services

| Service | Purpose | Notes |
|---------|---------|-------|
| Supabase | PostgreSQL + pgvector + Edge Functions + RLS | User's own project; keys stored encrypted in WP options |
| Gumroad | License validation + webhook | `GUMROAD_API_KEY` + HMAC secret stored in WP options |
| LLM providers | AI inference | One of: Anthropic, OpenAI, Gemini, Azure OpenAI, Groq, Ollama, custom endpoint |
| Embedding provider | text-embedding-3-small | OpenAI (default); configurable |
| WordPress site | Plugin host | Minimum WP 6.0, PHP 8.1 |

---

## 7. API Keys Required (Names Only — Never Values)

- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — Supabase publishable key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role (admin, server-side only)
- `LLM_API_KEY` — Key for chosen LLM provider (Anthropic / OpenAI / Gemini / Azure / Groq)
- `EMBEDDING_API_KEY` — OpenAI key for text-embedding-3-small
- `GUMROAD_API_KEY` — Gumroad license API
- `GUMROAD_WEBHOOK_SECRET` — HMAC secret for Gumroad webhook
- `WP_AI_AGENT_ENCRYPTION_KEY` — Dedicated wp-config constant for encrypting stored secrets (see Critical Bug #3)

---

## 8. Open Bugs (P0 = Critical, P1 = High)

### P0 — Must Fix Before Pilot Launch

**BUG-1 (ISSUE-001): Session token exposed in server logs**
- Location: `class-rest-api.php` + `chat-widget.js:467`
- Symptom: SSE stream URL contains `session_token` as GET parameter → token lands in Apache/Nginx access logs
- Fix: POST `/session/stream-token` → single-use `exchange_token` (30s TTL, signed); EventSource connects with `?exchange_token=` instead of `?session_token=`

**BUG-2 (ISSUE-002): Gumroad HMAC bypass when secret unconfigured**
- Location: `class-rest-api.php:761`
- Symptom: `if ($secret && !hash_equals(...))` — if `$secret` is empty string, HMAC check is silently skipped; any POST to webhook endpoint is accepted as valid
- Fix: If `$secret` is missing/empty, return 401 immediately and log `[WP_AI_AGENT_SECURITY] gumroad_hmac_unconfigured`

**BUG-3 (ISSUE-003): Encryption key derived from AUTH_KEY**
- Location: `class-settings.php:277-281`
- Symptom: `get_encryption_key()` derives key from `AUTH_KEY + AUTH_SALT`; key rotates when WordPress salts rotate (e.g., after a breach reset), silently corrupting all stored secrets
- Fix: Require `WP_AI_AGENT_ENCRYPTION_KEY` constant in `wp-config.php`; wp_die() on activation if absent

**BUG-4 (ISSUE-004): Default retention 90 days violates ECOA/Reg Z for mortgage/real estate**
- Location: `supabase/migrations/001_initial_schema.sql` — `cleanup_expired_data(retention_days INT DEFAULT 90)`
- Fix: Change DEFAULT to 780; add pack-aware override in `class-settings.php` that enforces 780 when mortgage or real_estate pack is active

### P1 — Fix Before v1.1

**BUG-5: Lead webhook fire-and-forget (no retry)**
- Location: `class-lead-capture.php`
- Fix: Queue failed deliveries in `agent_leads.webhook_retry_count`; retry with exponential backoff on next cron tick

**BUG-6: File upload polyglot bypass**
- Location: `class-security.php` file upload validation
- Fix: Validate MIME type via `finfo_file()` against allowlist, not just extension; strip EXIF/metadata from images before storing

**BUG-7: Regulatory search SSRF gap (mortgage + real estate packs)**
- Location: `class-mortgage-pack.php` `search_regulatory_sources()` + `class-real-estate-pack.php`
- Symptom: Calendar URL fetched from Supabase; regulatory search URL built from tool params — no metacharacter/scheme validation
- Fix: Validate all URLs against allowlist of regulatory domains (cfpb.gov, hud.gov, va.gov, usda.gov, fanniemae.com, freddiemac.com, hud.gov, nar.realtor, ftc.gov); reject non-HTTPS

**BUG-8: `--ai-text-muted` contrast ratio marginal**
- Location: `chat-widget.css`
- Value: `#64748b` — barely passes 4.5:1 against white; fails against off-white backgrounds
- Fix: Darken to `#475569`

**BUG-9: No prefers-reduced-motion**
- Location: `chat-widget.css`
- Fix: Add `@media (prefers-reduced-motion: reduce)` to disable transitions/animations

**BUG-10: Activation does not enforce is_ssl() or WP_AI_AGENT_ENCRYPTION_KEY**
- Location: `class-installer.php`
- Fix: On activation, `wp_die()` if `!is_ssl()` (with override constant); `wp_die()` if `WP_AI_AGENT_ENCRYPTION_KEY` not defined

---

## 9. What Is Needed to Meet Pilot Standards

The following must be completed before CHATAIPilot is Pilot-production-ready:

1. **Repo relocation** — Fork product code from `all-branches-export.zip` bundles into `workflowcio/workflowcio` under Pilot-standard path
2. **Manifest file** — Create `manifest.json` per WorkflowCIO Pilot spec
3. **CHANGELOG.md** — Document v1.0 release; format per Keep a Changelog
4. **Evals** — Add eval suite for: (a) guard rails bypass attempts, (b) pack compliance disclaimers, (c) lead capture intent detection accuracy, (d) Gumroad license enforcement
5. **Fix P0 bugs** — BUG-1 through BUG-4 are blockers
6. **Consolidate canonical directory** — `apps/chatbot-ai/` has 2 files not in `wordpress-ai-agent/` (DEVOPS.md, .env.example); merge into `wordpress-ai-agent/` as canonical
7. **Pack documentation** — Each pack needs its own README with compliance notes, data fields captured, and required external services
8. **10 remaining packs** — HVAC, roofing, plumbing, electrical, solar, contracting, landscaping, auto dealer, auto repair, financial planning
9. **E2E test suite** — Playwright or Cypress tests for golden path: widget load → conversation → lead capture → agent assignment → email transcript
10. **Security audit** — Independent review of BUG-1 through BUG-7 before any public release
11. **Websitebuilder integration** — Define the agent/skill interface by which Websitebuilder calls CHATAIPilot
