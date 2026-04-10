# Infrastructure & Deployment Audit — Initial Notes

Scope
- Review deployment config, environment variables, secrets handling, and scaling.

Files and places to review
- `bot-engine/main.py` (startup/shutdown lifecycle)
- `bot-engine/requirements.txt`, `runtime.txt`
- `next.config.js`, deployment manifests
- Dockerfiles or Render/Heroku/Cloud provider configs (if present)

Initial checklist
- [ ] Ensure secrets (`BOT_ENGINE_SECRET`, DB creds) come from environment and are not checked-in.
- [ ] Check auto-restart behavior and watchdog configuration for graceful restarts.
- [ ] Validate health endpoints and readiness checks are present.

Next steps
- Produce a checklist for secure environment variable handling and recommended infra health checks.

