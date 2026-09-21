# Conversational setup agent and YOLO catalogue

## Intent and decisions

Create a Kestrel detection project by describing the desired detector to GPT or Claude, reviewing an editable plan, choosing image folders, and running a small first labeling batch. The user delegated product decisions and explicitly requested no questions; design and execution proceed under that authorization.

Use a Setup agent drawer available from the shell, retaining its draft across closing and navigation. Match Contour tokens and primitives. A full-screen wizard would obscure the existing project workflow; free-form autonomous tool execution would make side effects unpredictable. A conversational planner with typed, visible actions provides a coherent path with existing project/import/inference APIs.

## Workflow

1. Select a configured GPT/OpenAI or Claude/Anthropic provider. Show the configured cloud model; missing keys link to App settings. Explain that chat is sent to that provider.
2. Describe objects, imagery, and desired detector. A bounded chat endpoint produces a message and nullable structured draft: project name, up to 32 unique class names, a supported YOLO starter key, image-selection guidance, and labeling query. Later turns can refine the draft. Neither provider gets tools, local paths, credentials, or full image sets.
3. Edit name/classes/model and choose a local project folder. Create the project with existing API, then acquire the chosen starter through a background job. Keep the created project ID even if later steps fail so retry never recreates it.
4. Choose a source image folder and import with existing background job/progress. Provide guidance on varied angles, sizes, lighting, empty scenes, and avoiding adjacent near-duplicate frames. No automatic imports from paths invented by the model.
5. Browse at most 24 image metadata/thumbnails per page, select a small first batch (at most 24), and obtain the existing cloud labeling estimate. User-visible Start first labeling submits the selected IDs with the reviewed query/provider. Selections or query/provider changes invalidate an estimate. Explain cloud image transfer and approximate API charges.
6. Show actual running, failed, cancelled, or succeeded job status, retry/recovery and navigation to Review. Suggestions stay unreviewed; no fabricated training success or auto-acceptance. The trained detector remains the ordinary dataset/train workflow.

## YOLO availability

Expose every standard box-detection YOLO family/scale compatible with installed Ultralytics: YOLO26, 12, 11, v10, v9, v8, v5u (including 6u), v3u (including spp/tiny). This is a task-compatible catalog, not a promise that unrelated third-party YOLO implementations or segmentation/pose/classification/OBB workflows work. New weights download only on selection, via a cancellable background import job; bundled weights remain available offline. Catalog labels distinguish cached availability from downloadable choices. Validate the registry against an allow-list and inspect detection task before registering weights.

## Contracts, security, and failure behavior

Contract first: add POST /api/v1/agent/chat with AgentChatRequest/AgentChatResponse/AgentPlan; add acquire-starter 202 JobRef and expand starter metadata/catalog keys. Generate schema.d.ts, never hand edit it. Existing APIs own project creation, source imports, inference, jobs and review.

Read API keys only from the existing KeyStore. Cloud adapters are lazy imports, use configured model names, finite timeouts/no SDK automatic retries, constrained output schemas and local validation. Never persist/log SDK exceptions or raw model output containing credentials. Fail with concise sanitized errors for missing key, refusal, malformed response, timeout and provider failure. Only user/assistant roles are accepted. Chat cannot mutate files or execute tools. Do not store API keys in UI state, projects, or settings.

## Budget

Chat: at most 12 messages, 2,000 characters each, current plan at most 32 classes; at most 4,000 output tokens, 45-second cloud timeout, bounded concurrent calls. No image reads for chat. Image picker: 24 metadata rows and thumbnails per request, no auto-pagination. First run: at most 24 selected images, existing tiled inference rate limits and cost estimate. Imports, model downloads, labeling, dataset generation, training and export are background jobs with progress. Model downloads stream chunks to temporary files and atomically publish completed assets; no full weights or full dataset in memory. UI async requests never freeze interaction.

## Execution DAG

Contract/spec -> [backend planner, frontend drawer, YOLO catalog] in parallel -> integration and browser workflow checks -> independent review/fixes -> full contract/backend/frontend gates -> merge main -> worktree/branch cleanup -> evidence/wrapup. Critical path: contract -> planner + drawer -> end-to-end -> gates -> merge. Shared interfaces are owned centrally; each implementation unit owns separate files.

## Verification

Test both provider adapters with fake SDKs, authentication, role/input bounds, invalid/unsupported plans, missing key, sanitized failures and refusal. Test drawer missing-key/retry paths, editable plan->create->import->selection->estimate->label->review, close/reopen retention, duplicate-action prevention and bounded queries. Test catalog families/keys, traversal rejection, background acquisition, cancellation, registry task checks and offline bundled behavior. Run all repository gates and browser checks without uploading user images or charging real provider keys. Live paid calls are not necessary to prove request construction and end-to-end integration.
