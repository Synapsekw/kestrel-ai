### Task 7: Integration

- [ ] Add an e2e spec `frontend/e2e/project-agent.spec.ts` in mock mode (Prism serves contract examples): open a project, open the agent drawer, see "Project agent", type a message, Send, and the request reaches `startAgentTurn` (mock returns the example turn). Look at an existing spec (e.g. `jobs.spec.ts`) for boot/project navigation helpers.
- [ ] Real-backend smoke with a fake provider: `backend/tests/test_project_agent_e2e.py` drives the complete "label the first 5 images with excavator and dump_truck" flow through HTTP only (fake LLM script), asserting classes updated, approval shown with cost, approve, query run image_ids == first 5 by path, job queued.
- [ ] Commit `test(agent): project agent end-to-end checks`.

