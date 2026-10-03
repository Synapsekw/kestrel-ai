import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths };
export type Schemas = components["schemas"];
export type Health = Schemas["Health"];
export type Project = Schemas["Project"];
export type ProjectAvailability = Schemas["ProjectAvailability"];
export type ProjectCreate = Schemas["ProjectCreate"];
export type ProjectSummary = Schemas["ProjectSummary"];
export type MigrationState = Schemas["MigrationState"];
export type ProjectTypesUpdate = Schemas["ProjectTypesUpdate"];
export type CatalogueKind = Schemas["CatalogueKind"];
export type ClassDef = Schemas["ClassDef"];
export type ImportSettings = Schemas["ImportSettings"];
export type Stats = Schemas["Stats"];
export type Source = Schemas["Source"];
export type Image = Schemas["Image"];
export type ImagePage = Schemas["ImagePage"];
export type Box = Schemas["Box"];
export type BoxCreate = Schemas["BoxCreate"];
export type BoxUpdate = Schemas["BoxUpdate"];
export type Provenance = Schemas["Provenance"];
export type ReviewState = Schemas["ReviewState"];
export type LibraryModel = Schemas["LibraryModel"];
export type LibraryModelImport = Schemas["LibraryModelImport"];
export type LibraryModelPatch = Schemas["LibraryModelPatch"];
export type ModelProvenance = Schemas["ModelProvenance"];
export type ModelUsage = Schemas["ModelUsage"];
export type LibraryStatus = Schemas["LibraryStatus"];
export type ModelMetrics = Schemas["ModelMetrics"];
export type StarterModel = Schemas["StarterModel"];
export type StarterModelKey = Schemas["StarterModelKey"];
export type TrainRequest = Schemas["TrainRequest"];
export type Provider = Schemas["Provider"];
export type ProviderName = Schemas["ProviderName"];
export type QueryRun = Schemas["QueryRun"];
export type QueryRunCreate = Schemas["QueryRunCreate"];
export type Tiling = Schemas["Tiling"];
export type CostEstimate = Schemas["CostEstimate"];
export type Job = Schemas["Job"];
export type JobState = Schemas["JobState"];
export type JobType = Schemas["JobType"];
export type JobLog = Schemas["JobLog"];
export type ApiError = Schemas["Error"];
export type AppEvent = Schemas["Event"];
export type AgentTurn = Schemas["AgentTurn"];
export type AgentTurnState = Schemas["AgentTurnState"];
export type AgentItem = Schemas["AgentItem"];
export type AgentToolStatus = Schemas["AgentToolStatus"];
export type AgentApproval = Schemas["AgentApproval"];
export type AgentNavigate = Schemas["AgentNavigate"];
export type AgentConversation = Schemas["AgentConversation"];
export type GeoMap = Schemas["GeoMap"];
export type MapRun = Schemas["MapRun"];
export type MapRunCreate = Schemas["MapRunCreate"];
export type MapDetection = Schemas["MapDetection"];
export type MapZone = Schemas["MapZone"];
export type MapLabel = Schemas["MapLabel"];
export type MapScore = Schemas["MapScore"];
export type PointCloud = Schemas["PointCloudOut"];
export type CloudMeasurement = Schemas["CloudMeasurementOut"];
export type CloudMeasurementKind = Schemas["CloudMeasurementKind"];
export type CloudMeasurementStatus = Schemas["CloudMeasurementStatus"];
export type CloudMeasurementParams = Schemas["CloudMeasurementParams"];
export type CloudMeasurementWithJob = Schemas["CloudMeasurementWithJob"];
export type CloudViewOut = Schemas["CloudViewOut"];
export type CloudViewPose = Schemas["CloudViewPose"];
export type CloudViewRender = Schemas["CloudViewRender"];
export type CloudClipBox = Schemas["CloudClipBox"];
export type CloudViewSubjectKind = Schemas["CloudViewSubjectKind"];
export type CloudProfile = Schemas["CloudProfile"];
export type CloudCameraSet = Schemas["CloudCameraSet"];
export type CloudCameraSource = Schemas["CloudCameraSource"];
export type CloudCameraOffsetPut = Schemas["CloudCameraOffsetPut"];
export type CloudViewMeta = Schemas["CloudViewMeta"];
export type CloudViewList = Schemas["CloudViewList"];
export type Surface = Schemas["Surface"];
export type VolumeMeasurement = Schemas["VolumeMeasurement"];
export type CatalogueType = Schemas["CatalogueType"];
export type CatalogueTypePage = Schemas["CatalogueTypePage"];
export type CatalogueTypeCreate = Schemas["CatalogueTypeCreate"];
export type CatalogueTypePatch = Schemas["CatalogueTypePatch"];
export type CatalogueTypeUpdated = Schemas["CatalogueTypeUpdated"];
export type SeverityLevel = Schemas["SeverityLevel"];
export type SeverityScale = Schemas["SeverityScale"];
export type OperatorSettings = Schemas["OperatorSettings"];
export type DataItemType = Schemas["DataItemType"];
export type Finding = Schemas["Finding"];
export type FindingDetail = Schemas["FindingDetail"];
export type FindingPage = Schemas["FindingPage"];
export type FindingStatus = Schemas["FindingStatus"];
export type FindingAnchor = Schemas["FindingAnchor"];
export type FindingAnchorKind = Schemas["FindingAnchorKind"];
export type FindingAnchorInput = Schemas["FindingAnchorInput"];
export type FindingAnchorPatch = Schemas["FindingAnchorPatch"];
export type FindingCreate = Schemas["FindingCreate"];
export type FindingPatch = Schemas["FindingPatch"];
export type FindingSummary = Schemas["FindingSummary"];
export type FindingComment = Schemas["FindingComment"];
export type FindingAttachment = Schemas["FindingAttachment"];
export type AppJob = Schemas["AppJob"];
export type AppJobPage = Schemas["AppJobPage"];
export type DataItem = Schemas["DataItem"];
export type DataItemPage = Schemas["DataItemPage"];
export type ProjectOverview = Schemas["ProjectOverview"];
export type ProjectSearchResult = Schemas["ProjectSearchResult"];
export type Activity = Schemas["Activity"];
export type ModelTask = Schemas["ModelTask"];
export type LibraryModelClassMapPut = Schemas["LibraryModelClassMapPut"];
export type LibraryDataset = Schemas["LibraryDataset"];
export type LibraryDatasetItem = Schemas["LibraryDatasetItem"];
export type DatasetFilter = Schemas["DatasetFilter"];
export type DatasetPreview = Schemas["DatasetPreview"];
export type TrainingRun = Schemas["TrainingRun"];

// Images (plan 2026-09-27-images-c0)
export type ImageDetail = Schemas["ImageDetail"];
export type ImageCamera = Schemas["ImageCamera"];
export type ImageFootprintKind = Schemas["ImageFootprintKind"];
export type ImageIndex = Schemas["ImageIndex"];
export type ImageFilter = Schemas["ImageFilter"];
export type BoxShape = Schemas["BoxShape"];
export type BoxWriteResult = Schemas["BoxWriteResult"];
export type BoxReviewResult = Schemas["BoxReviewResult"];
export type ImageMeasurement = Schemas["ImageMeasurement"];
export type ImageMeasurementCreate = Schemas["ImageMeasurementCreate"];
export type ImageMeasurementList = Schemas["ImageMeasurementList"];
export type ComputeDevice = Schemas["ComputeDevice"];
export type DetectRequest = Schemas["DetectRequest"];
export type DetectResult = Schemas["DetectResult"];
export type DetectBatchRequest = Schemas["DetectBatchRequest"];
export type DetectBatchScope = Schemas["DetectBatchScope"];
export type SegmentCrop = Schemas["SegmentCrop"];
export type SegmentPoint = Schemas["SegmentPoint"];
export type SegmentPrepareRequest = Schemas["SegmentPrepareRequest"];
export type SegmentPrepared = Schemas["SegmentPrepared"];
export type SegmentRequest = Schemas["SegmentRequest"];
export type SegmentResult = Schemas["SegmentResult"];
export type AssistModel = Schemas["AssistModel"];
export type AssistModelKey = Schemas["AssistModelKey"];
export type AssistModelPage = Schemas["AssistModelPage"];
export type AssistModelImport = Schemas["AssistModelImport"];

export type SiteFrame = Schemas["SiteFrame"];
export type MapWorkspace = Schemas["MapWorkspace"];
export type WorkspaceSurvey = Schemas["WorkspaceSurvey"];
export type WorkspaceLayer = Schemas["WorkspaceLayer"];
export type SiteTileKind = Schemas["SiteTileKind"];
export type MapFindingPin = Schemas["MapFindingPin"];
export type ElevationRole = Schemas["ElevationRole"];
export type Drawing = Schemas["Drawing"];
export type KeyedProviderName = Schemas["KeyedProviderName"];
export type AssetModel = Schemas["AssetModel"];
export type AssetModelVersion = Schemas["AssetModelVersion"];
export type AssetModelVersionDetail = Schemas["AssetModelVersionDetail"];
export type AssetSpec = Schemas["AssetSpec"];
export type AssetPart = Schemas["AssetPart"];
export type SpecIssue = Schemas["SpecIssue"];
export type AssetSourceRef = Schemas["AssetSourceRef"];
export type AssetModelRun = Schemas["AssetModelRun"];
export type AssetModelRunStep = Schemas["AssetModelRunStep"];
export type AssetModelRunStart = Schemas["AssetModelRunStart"];
export type AssetVec3 = Schemas["AssetVec3"];
export type AssetFrame = Schemas["AssetFrame"];
export type AssetFrameOrigin = Schemas["AssetFrameOrigin"];
export type AssetFramePreset = Schemas["AssetFramePreset"];
export type AssetFrameConversion = Schemas["AssetFrameConversion"];
export type AssetProfileId = Schemas["AssetProfileId"];
export type AssetReviewConfig = Schemas["AssetReviewConfig"];
export type AssetReviewZone = Schemas["AssetReviewZone"];
export type AssetReviewChoice = Schemas["AssetReviewChoice"];
export type AssetGlbImport = Schemas["AssetGlbImport"];
export type ImagePose = Schemas["ImagePose"];
export type ImagePoseIn = Schemas["ImagePoseIn"];
export type ImagePoseList = Schemas["ImagePoseList"];
export type ImagePoseSource = Schemas["ImagePoseSource"];
export type ImagePoseEstimate = Schemas["ImagePoseEstimate"];
export type ImageReview = Schemas["ImageReview"];
export type ImageReviewPut = Schemas["ImageReviewPut"];
export type ImageReviewStatus = Schemas["ImageReviewStatus"];
export type Placement = Schemas["Placement"];
export type PlacementList = Schemas["PlacementList"];
export type PlacementCompute = Schemas["PlacementCompute"];
export type FindingAssetAnchor = Schemas["FindingAssetAnchor"];
export type FindingAssetAnchorInput = Schemas["FindingAssetAnchorInput"];
export type FindingSightingInput = Schemas["FindingSightingInput"];
export type FindingSighting = Schemas["FindingSighting"];
export type FindingSightingList = Schemas["FindingSightingList"];
export type FindingSightingPlacement = Schemas["FindingSightingPlacement"];
export type FindingRepresentative = Schemas["FindingRepresentative"];
export type FindingMerge = Schemas["FindingMerge"];
export type FindingSplit = Schemas["FindingSplit"];
export type ReviewImportRequest = Schemas["ReviewImportRequest"];
export type ReviewImportPreview = Schemas["ReviewImportPreview"];
export type Brand = Schemas["Brand"];
export type BrandList = Schemas["BrandList"];
export type BrandCreate = Schemas["BrandCreate"];
export type BrandPatch = Schemas["BrandPatch"];
export type BrandColors = Schemas["BrandColors"];
export type BrandLogoSlot = Schemas["BrandLogoSlot"];
export type BrandLogoImport = Schemas["BrandLogoImport"];
export type DrawingInspection = Schemas["DrawingInspection"];
export type DrawingGeoref = Schemas["DrawingGeoref"];
export type DrawingVectorTile = Schemas["DrawingVectorTile"];
export type MapMeasurement = Schemas["MapMeasurement"];
export type MeasurementItem = Schemas["MeasurementItem"];

export interface ApiClientOptions {
  /** Backend origin, e.g. http://127.0.0.1:8765 (no path). */
  baseUrl: string;
  /** Per-launch token; sent as `Authorization: Bearer`. */
  token: string;
  fetch?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: opts.baseUrl.replace(/\/$/, ""),
    fetch: opts.fetch,
  });
  const auth: Middleware = {
    onRequest({ request }) {
      request.headers.set("Authorization", `Bearer ${opts.token}`);
      return request;
    },
  };
  client.use(auth);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Websocket URL for `/api/v1/events` with the token as a query parameter. */
export function eventsUrl(baseUrl: string, token: string): string {
  const ws = baseUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return `${ws}/api/v1/events?token=${encodeURIComponent(token)}`;
}

/** URL for an `<img src>`: the token goes in the query because images cannot send headers. */
export function imageFileUrl(baseUrl: string, token: string, projectId: string, imageId: string, maxSide?: number): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  if (maxSide) q.set("max_side", String(maxSide));
  return `${base}/api/v1/projects/${projectId}/images/${imageId}/file?${q}`;
}

export function assetModelGlbUrl(baseUrl: string, token: string, projectId: string, assetModelId: string, version: number): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/asset-models/${assetModelId}/versions/${version}/glb?${q}`;
}

export function assetModelOverlayUrl(
  baseUrl: string, token: string, projectId: string, assetModelId: string, runId: string, cloudId: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/asset-models/${assetModelId}/runs/${runId}/overlay/${cloudId}?${q}`;
}

function placementFileUrl(
  part: "mesh" | "texture" | "labels",
  baseUrl: string,
  token: string,
  projectId: string,
  assetModelId: string,
  sightingId: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/asset-models/${assetModelId}/placements/${sightingId}/${part}?${q}`;
}

/** A patch's triangles: a little-endian uint32 vertex count n, then n x 3 Float32 positions, then n x 2 Float32 uvs (contract `getPlacementMesh`). */
export function placementMeshUrl(
  baseUrl: string, token: string, projectId: string, assetModelId: string, sightingId: string,
): string {
  return placementFileUrl("mesh", baseUrl, token, projectId, assetModelId, sightingId);
}

/** A patch's PNG texture with alpha (contract `getPlacementTexture`). */
export function placementTextureUrl(
  baseUrl: string, token: string, projectId: string, assetModelId: string, sightingId: string,
): string {
  return placementFileUrl("texture", baseUrl, token, projectId, assetModelId, sightingId);
}

/** A patch's uint8 label grid for pixel-exact picking (contract `getPlacementLabels`). */
export function placementLabelsUrl(
  baseUrl: string, token: string, projectId: string, assetModelId: string, sightingId: string,
): string {
  return placementFileUrl("labels", baseUrl, token, projectId, assetModelId, sightingId);
}

/** A brand's logo in one slot (contract `getBrandLogo`); brands are app-wide, not per project. */
export function brandLogoUrl(baseUrl: string, token: string, brandId: string, slot: BrandLogoSlot): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/brands/${brandId}/logos/${slot}?${q}`;
}

export function thumbnailUrl(baseUrl: string, token: string, projectId: string, imageId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/v1/projects/${projectId}/images/${imageId}/thumbnail?token=${encodeURIComponent(token)}`;
}

/** OpenLayers tile URL template for a map: `{z}`, `{x}` and `{y}` are left for the source to fill. */
export function mapTileUrl(baseUrl: string, token: string, projectId: string, mapId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/maps/${mapId}/tiles/{z}/{x}/{y}?${q}`;
}

export type BasemapSource = "satellite" | "streets";

/** A keyless basemap tile template (`{z}/{x}/{y}` left in), proxied and cached by the backend. */
export function basemapTileUrl(baseUrl: string, token: string, source: BasemapSource): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/basemap/${source}/{z}/{x}/{y}?${q}`;
}

export function mapPreviewUrl(baseUrl: string, token: string, projectId: string, mapId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/maps/${mapId}/preview?${q}`;
}

/**
 * The point cloud's Potree `metadata.json` URL, WITHOUT the token: the viewer's potree-core
 * RequestManager appends `?token=` to every URL it fetches, and the loader derives the
 * `hierarchy.bin` and `octree.bin` URLs with `.replace("/metadata.json", ...)`, which keeps it.
 */
export function cloudOctreeUrl(baseUrl: string, projectId: string, cloudId: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/v1/projects/${projectId}/pointclouds/${cloudId}/octree/metadata.json`;
}

/** OpenLayers tile URL template for a surface's hillshade; `tint` adds the hypsometric ramp. */
export function surfaceTileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  surfaceId: string,
  tint = false,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  if (tint) q.set("tint", "true");
  return `${base}/api/v1/projects/${projectId}/surfaces/${surfaceId}/tiles/{z}/{x}/{y}?${q}`;
}

/** OpenLayers tile URL template for a map's orthomosaic warped into a surface's grid. */
export function surfaceOrthoTileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  surfaceId: string,
  mapId: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token, map_id: mapId });
  return `${base}/api/v1/projects/${projectId}/surfaces/${surfaceId}/ortho-tiles/{z}/{x}/{y}?${q}`;
}

/** OpenLayers tile URL template for a volume's cut/fill overlay; `v` busts the cache per calculation. */
export function volumeDiffTileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  measurementId: string,
  v?: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  if (v) q.set("v", v);
  return `${base}/api/v1/projects/${projectId}/volumes/${measurementId}/diff-tiles/{z}/{x}/{y}?${q}`;
}

/**
 * OpenLayers tile URL template for one layer in the project's site tile grid (map-workspace spec §6):
 * `v` is the layer's `version` from `listWorkspaceLayers`; `extra` carries `style`, `interval` or
 * `knockout`.
 */
export function siteTileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  kind: SiteTileKind,
  layerId: string,
  v: string,
  extra: Record<string, string> = {},
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token, v, ...extra });
  return `${base}/api/v1/projects/${projectId}/site-tiles/${kind}/${layerId}/{z}/{x}/{y}?${q}`;
}

/** URL template for a DXF or LandXML drawing's vector tiles on the site tile grid; `v` is its `georef_version`. */
export function drawingVectorTileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  drawingId: string,
  v: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token, v });
  return `${base}/api/v1/projects/${projectId}/drawings/${drawingId}/vtiles/{z}/{x}/{y}?${q}`;
}

export function drawingThumbnailUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  drawingId: string,
): string {
  const base = baseUrl.replace(/\/$/, "");
  return `${base}/api/v1/projects/${projectId}/drawings/${drawingId}/thumbnail?${new URLSearchParams({ token })}`;
}

export function drawingPageThumbnailUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  inspectionId: string,
  page: number,
): string {
  const base = baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({ token });
  return `${base}/api/v1/projects/${projectId}/drawing-inspections/${inspectionId}/pages/${page}/thumbnail?${q}`;
}

// Reports (plan 2026-09-30-reports-r0).
export type SectionKey = Schemas["SectionKey"];
export type ReportConfig = Schemas["ReportConfig"];
export type ReportFilters = Schemas["ReportFilters"];
export type ReportSection = Schemas["ReportSection"];
export type Report = Schemas["Report"];
export type ReportListItem = Schemas["ReportListItem"];
export type ReportPage = Schemas["ReportPage"];
export type ReportOutline = Schemas["ReportOutline"];
export type OutlineSection = Schemas["OutlineSection"];
export type DeltaSummary = Schemas["DeltaSummary"];
export type ReportWarning = Schemas["ReportWarning"];
export type Block = Schemas["Block"];
export type BlockPage = Schemas["BlockPage"];
export type TableCell = Schemas["TableCell"];
export type CoverBlock = Schemas["CoverBlock"];
export type SnapshotSpec = Schemas["SnapshotSpec"];
export type SnapshotRef = Schemas["SnapshotRef"];
export type ReportDocument = Schemas["ReportDocument"];
export type ReportDocumentPage = Schemas["ReportDocumentPage"];
export type ReportVersion = Schemas["ReportVersion"];
export type ReportVersionPage = Schemas["ReportVersionPage"];
export type ReportFile = Schemas["ReportFile"];
export type ReportTemplate = Schemas["ReportTemplate"];
export type ReportTemplatePage = Schemas["ReportTemplatePage"];
export type ReportAsset = Schemas["ReportAsset"];
export type RenderRequest = Schemas["RenderRequest"];
// Project setup (plan 2026-09-30-setup-u1).
export type SeverityRule = Schemas["SeverityRule"];
export type CatalogueTypeSpec = Schemas["CatalogueTypeSpec"];
export type EnsureTypesRequest = Schemas["EnsureTypesRequest"];
export type EnsureTypesResult = Schemas["EnsureTypesResult"];
export type EnsuredType = Schemas["EnsuredType"];
export type TypeConflict = Schemas["TypeConflict"];
export type SlotRoute = Schemas["SlotRoute"];
export type SlotMatch = Schemas["SlotMatch"];
export type TemplateSlot = Schemas["TemplateSlot"];
export type TemplateConfig = Schemas["TemplateConfig"];
export type ProjectTemplate = Schemas["ProjectTemplate"];
export type ProjectTemplatePage = Schemas["ProjectTemplatePage"];
export type ProjectTemplateCreate = Schemas["ProjectTemplateCreate"];
export type ProjectTemplatePatch = Schemas["ProjectTemplatePatch"];
export type SetupInspectRequest = Schemas["SetupInspectRequest"];
export type InspectBucket = Schemas["InspectBucket"];
export type InspectSkipped = Schemas["InspectSkipped"];
export type InspectNotRecognised = Schemas["InspectNotRecognised"];
export type InspectResult = Schemas["InspectResult"];
