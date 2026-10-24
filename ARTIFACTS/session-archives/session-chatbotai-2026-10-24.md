# Session Archive — ChatbotAI / CHATAIPilot Development

**Session retired:** 2026-10-24  
**Repository:** `workflowcio/n8n-ai-automations`  
**Branch:** `claude/wordpress-ai-agent-supabase-GDsYH`  
**Reason:** Product decision — ChatbotAI becomes standalone CHATAIPilot in `workflowcio/workflowcio`

---

## Session Identity

| Field | Value |
|-------|-------|
| Primary branch | `claude/wordpress-ai-agent-supabase-GDsYH` |
| Repo | `workflowcio/n8n-ai-automations` |
| Remote | `https://github.com/workflowcio/n8n-ai-automations` |
| Session transcript | `/root/.claude/projects/-home-user-n8n-ai-automations/8a663619-5fae-515c-9988-1d50448be7c4.jsonl` |
| PRD PDF | `The_Recap_AI_PRD_v1.0.pdf` (pushed to branch; downloaded by David 2026-06-14) |
| All-branches zip | `all-branches-export.zip` (all 4 claude/* branches bundled; downloaded by David 2026-06-14) |

---

## What Was Built

A production-grade **WordPress plugin** (WP AI Agent / ChatbotAI — Supabase Edition) featuring:

- Streaming AI chat widget (SSE, vanilla JS, no React dependency)
- BYOLLM architecture (Anthropic, OpenAI, Gemini, Azure OpenAI, Groq, Ollama, custom endpoint)
- RAG via Supabase pgvector (text-embedding-3-small, 1536-dim, IVFFlat)
- 7 complete industry add-on packs: Mortgage, Real Estate, Recruiting, Legal, Medical, Dental, Insurance
- 10 packs planned but not built: HVAC, Roofing, Plumbing, Electrical, Solar, Contracting, Landscaping, Auto Dealer, Auto Repair, Financial Planning
- Gumroad licensing with seat enforcement and per-pack gating
- Lead capture with progressive intent scoring and CRM webhook delivery
- Multi-agent routing (returning client recognition, round-robin, availability states)
- Guard rails: PII redaction, prompt injection prevention, crisis detection (988 Lifeline)
- WCAG 2.1 AA accessibility
- Full Supabase migration suite (001–004) with RLS on all tables
- Integration templates: n8n, Zapier, Make.com

---

## Key Files (All Committed to Branch; Container Recycled)

```
wordpress-ai-agent/           # Canonical plugin directory
  includes/                   # 14 PHP classes
  assets/                     # chat-widget.js, chat-widget.css
  supabase/migrations/        # 001-004 SQL migrations
  automation/                 # n8n, Zapier, Make templates
  docs/v1.0-specification.md  # 1,215-line full spec

apps/chatbot-ai/              # Near-duplicate (has DEVOPS.md + .env.example)
PRD.md                        # 929-line PRD
PRD_supplement.json           # 20 known issues, feature map, pack spec, roadmap
SCOPE_CLARIFICATION.json      # Documents which files are out-of-scope (n8n workflows)
```

---

## Branches in This Repo (All Downloaded)

| Branch | Status |
|--------|--------|
| `claude/wordpress-ai-agent-supabase-GDsYH` | Current; product code committed; downloaded 2026-06-14 |
| Other `claude/*` branches | Downloaded; user to fork into `workflowcio/workflowcio` |

---

## Decisions Made This Session

1. `apps/chatbot-ai/` is an alias of `wordpress-ai-agent/`; `wordpress-ai-agent/` is canonical
2. 38 n8n workflow JSONs at repo root are out of scope (The Recap AI project)
3. Plugin ships BYOLLM — no LLM provider hard dependency
4. Mortgage pack: ECOA disclaimer hardcoded in `assess_eligibility()` return (not configurable)
5. Crisis detection (988 Lifeline, Tier 1+2) is non-bypassable by any config or LLM instruction

---

## Open Bugs at Retirement (P0 = blocker)

| ID | Priority | Summary |
|----|----------|---------|
| BUG-1 | P0 | Session token in SSE URL GET param → server log exposure |
| BUG-2 | P0 | Gumroad HMAC check skipped when secret is empty |
| BUG-3 | P0 | Encryption key derived from AUTH_KEY (rotates on WP salt reset) |
| BUG-4 | P0 | Default 90-day retention violates ECOA/Reg Z 25-month requirement |
| BUG-5 | P1 | CRM webhook fire-and-forget (no retry) |
| BUG-6 | P1 | File upload polyglot bypass (MIME not validated via finfo) |
| BUG-7 | P1 | Regulatory search SSRF gap (no domain allowlist) |
| BUG-8 | P1 | `--ai-text-muted` contrast marginal (#64748b → #475569) |
| BUG-9 | P1 | No prefers-reduced-motion media query |
| BUG-10 | P1 | Activation doesn't enforce is_ssl() or WP_AI_AGENT_ENCRYPTION_KEY |

Full remediation details: `DOCS/HANDOVERS/CHATAIPilot-handover-2026-10-24.md`

---

## External Services (Continue With Product — Not Shut Down)

- Supabase (user's own project)
- Gumroad (license management)
- LLM providers (user-supplied API keys)
- OpenAI Embeddings (text-embedding-3-small)

---

## Credentials Held

None held by this session. All API keys were stored encrypted in WordPress options on the user's site. Session only accessed key names, never values.

---

## Scheduled Jobs / Open Client Work

None. No cron jobs, webhooks, or scheduled tasks were created by this session. No open client deliverables.

---

## Follow-Up for CHATAIPilot in `workflowcio/workflowcio`

1. Fork product code from downloaded branch bundles into `workflowcio/workflowcio` under Pilot-standard path
2. Create `manifest.json`, `CHANGELOG.md`, pack READMEs per Pilot standards
3. Fix P0 bugs (BUG-1 through BUG-4) before any customer-facing deployment
4. Add eval suite (guard rails, pack compliance, lead capture accuracy, license enforcement)
5. Build 10 remaining packs: HVAC, Roofing, Plumbing, Electrical, Solar, Contracting, Landscaping, Auto Dealer, Auto Repair, Financial Planning
6. Define Websitebuilder ↔ CHATAIPilot agent/skill interface
