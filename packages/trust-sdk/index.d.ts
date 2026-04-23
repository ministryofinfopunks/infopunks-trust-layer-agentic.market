import type {
  AttestationBundle as OpenApiAttestationBundle,
  AttestationBundleRequest as OpenApiAttestationBundleRequest,
  BudgetQuote as OpenApiBudgetQuote,
  BudgetQuoteRequest as OpenApiBudgetQuoteRequest,
  DisputeEvaluateRequest as OpenApiDisputeEvaluateRequest,
  DisputeEvaluation as OpenApiDisputeEvaluation,
  EscrowQuote as OpenApiEscrowQuote,
  EscrowQuoteRequest as OpenApiEscrowQuoteRequest,
  ErrorEnvelope as OpenApiErrorEnvelope,
  EvidenceAcceptedResponse as OpenApiEvidenceAcceptedResponse,
  EvidenceContext as OpenApiEvidenceContext,
  EvidenceCreateRequest as OpenApiEvidenceCreateRequest,
  EvidenceOutcome as OpenApiEvidenceOutcome,
  EvidenceValidator as OpenApiEvidenceValidator,
  Passport as OpenApiPassport,
  PassportCapability as OpenApiPassportCapability,
  PassportCreateRequest as OpenApiPassportCreateRequest,
  PassportCreated as OpenApiPassportCreated,
  PassportIssuer as OpenApiPassportIssuer,
  PassportRotateKeyRequest as OpenApiPassportRotateKeyRequest,
  PassportPublicKey as OpenApiPassportPublicKey,
  PromptPack as OpenApiPromptPack,
  PortabilityImportRequest as OpenApiPortabilityImportRequest,
  PortabilityImportResult as OpenApiPortabilityImportResult,
  PortabilityExportRequest as OpenApiPortabilityExportRequest,
  ReputationScopeDefaults as OpenApiReputationScopeDefaults,
  RiskPriceQuote as OpenApiRiskPriceQuote,
  RiskPriceRequest as OpenApiRiskPriceRequest,
  RoutingDecision as OpenApiRoutingDecision,
  RoutingSelectExecutorRequest as OpenApiRoutingSelectExecutorRequest,
  RoutingSelectValidatorRequest as OpenApiRoutingSelectValidatorRequest,
  SimRunRequest as OpenApiSimRunRequest,
  SimRunResponse as OpenApiSimRunResponse,
  TraceReplayBundle as OpenApiTraceReplayBundle,
  TrustPortabilityBundle as OpenApiTrustPortabilityBundle,
  TrustEvent as OpenApiTrustEvent,
  TrustExplainResponse as OpenApiTrustExplainResponse,
  TrustResolution as OpenApiTrustResolution,
  TrustResolveRequest as OpenApiTrustResolveRequest,
  WebhookCreateRequest as OpenApiWebhookCreateRequest,
  WebhookSubscription as OpenApiWebhookSubscription,
  QuorumPolicy as OpenApiQuorumPolicy
} from "./generated-contracts";

export type TrustBand = OpenApiTrustResolution["band"];
export type TrustDecision = OpenApiTrustResolution["decision"];
export type SubjectType = OpenApiPassport["subject_type"];

export type Passport = OpenApiPassport;
export type PassportCreated = OpenApiPassportCreated;
export type PassportCapability = OpenApiPassportCapability;
export type PassportIssuer = OpenApiPassportIssuer;
export type PassportReputationScopeDefaults = OpenApiReputationScopeDefaults;
export type EvidenceContext = OpenApiEvidenceContext;
export type EvidenceOutcome = OpenApiEvidenceOutcome;
export type EvidenceAcceptedResponse = OpenApiEvidenceAcceptedResponse;
export type TrustResolution = OpenApiTrustResolution;
export type RoutingDecision = OpenApiRoutingDecision;
export type PromptPack = OpenApiPromptPack;
export type TrustExplainResponse = OpenApiTrustExplainResponse;
export type TraceReplayBundle = OpenApiTraceReplayBundle;
export type TrustEvent = OpenApiTrustEvent;
export type SimRunResponse = OpenApiSimRunResponse;
export type ErrorEnvelope = OpenApiErrorEnvelope;
export type DisputeEvaluation = OpenApiDisputeEvaluation;
export type WebhookSubscription = OpenApiWebhookSubscription;
export type QuorumPolicy = OpenApiQuorumPolicy;
export type BudgetQuote = OpenApiBudgetQuote;
export type TrustPortabilityBundle = OpenApiTrustPortabilityBundle;
export type PortabilityImportResult = OpenApiPortabilityImportResult;
export type EscrowQuote = OpenApiEscrowQuote;
export type RiskPriceQuote = OpenApiRiskPriceQuote;
export type AttestationBundle = OpenApiAttestationBundle;

export interface QuorumPolicyInput extends Omit<OpenApiQuorumPolicy, "required_count" | "consensus_threshold" | "escalation_action"> {
  requiredCount?: number;
  required_count?: number;
  consensusThreshold?: number;
  consensus_threshold?: number;
  escalationAction?: OpenApiQuorumPolicy["escalation_action"];
  escalation_action?: OpenApiQuorumPolicy["escalation_action"];
}

export interface RequestOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface InfopunksOptions {
  apiKey: string;
  baseUrl?: string;
  environment?: "local" | "dev" | "staging" | "prod";
  timeoutMs?: number;
}

export interface PassportPublicKeyInput extends Partial<OpenApiPassportPublicKey> {
  kid?: string;
  alg?: string;
  publicKey?: string;
  public_key?: string;
}

export interface PassportCapabilityInput extends Partial<OpenApiPassportCapability> {
  name: string;
  version?: string;
  verified?: boolean;
}

export interface PassportMetadata {
  framework?: string;
  ownerOrg?: string;
  owner_org?: string;
  modelClass?: string;
  model_class?: string;
  runtimeVersion?: string;
  runtime_version?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface PassportRegisterInput
  extends Omit<
    OpenApiPassportCreateRequest,
    "subject_id" | "subject_type" | "public_keys" | "capabilities" | "reputation_scope_defaults" | "metadata"
  > {
  subjectId?: string;
  subject_id?: string;
  subjectType?: SubjectType;
  subject_type?: SubjectType;
  publicKeys?: Array<string | PassportPublicKeyInput>;
  public_keys?: Array<PassportPublicKeyInput>;
  capabilities?: Array<string | PassportCapabilityInput>;
  reputationScopeDefaults?: PassportReputationScopeDefaults;
  reputation_scope_defaults?: PassportReputationScopeDefaults;
  metadata?: PassportMetadata;
}

export interface PassportRotateKeyInput extends Omit<OpenApiPassportRotateKeyRequest, "key"> {
  key: string | PassportPublicKeyInput;
}

export interface EvidenceValidatorInput extends Omit<OpenApiEvidenceValidator, "validator_id" | "reason_codes"> {
  validatorId?: string;
  validator_id?: string;
  reasonCodes?: string[];
  reason_codes?: string[];
}

export interface EvidenceProvenanceInput {
  sourceSystem?: string;
  source_system?: string;
  traceId?: string;
  trace_id?: string;
  spanId?: string;
  span_id?: string;
  [key: string]: unknown;
}

export interface EvidenceRecordInput
  extends Omit<OpenApiEvidenceCreateRequest, "subject_id" | "event_type" | "task_id" | "validators" | "provenance"> {
  subjectId?: string;
  subject_id?: string;
  eventType?: OpenApiEvidenceCreateRequest["event_type"];
  event_type?: OpenApiEvidenceCreateRequest["event_type"];
  taskId?: string;
  task_id?: string;
  validators?: EvidenceValidatorInput[];
  provenance?: EvidenceProvenanceInput;
}

export interface TrustResolveInput
  extends Omit<OpenApiTrustResolveRequest, "subject_id" | "policy_id" | "policy_version" | "response_mode" | "candidate_validators"> {
  subjectId?: string;
  subject_id?: string;
  policyId?: string;
  policy_id?: string;
  policyVersion?: string;
  policy_version?: string;
  responseMode?: OpenApiTrustResolveRequest["response_mode"];
  response_mode?: OpenApiTrustResolveRequest["response_mode"];
  candidateValidators?: string[];
  candidate_validators?: string[];
}

export type RecommendedValidator = TrustResolution["recommended_validators"][number];

export interface RoutingSelectValidatorInput
  extends Omit<OpenApiRoutingSelectValidatorRequest, "task_id" | "subject_id" | "minimum_count"> {
  taskId?: string;
  task_id?: string;
  subjectId?: string;
  subject_id?: string;
  minimumCount?: number;
  minimum_count?: number;
  quorumPolicy?: QuorumPolicyInput;
  quorum_policy?: QuorumPolicyInput;
}

export interface RoutingSelectExecutorInput
  extends Omit<
    OpenApiRoutingSelectExecutorRequest,
    "task_id" | "subject_id" | "minimum_count" | "maximum_cost_usd" | "allow_autonomy_downgrade"
  > {
  taskId?: string;
  task_id?: string;
  subjectId?: string;
  subject_id?: string;
  minimumCount?: number;
  minimum_count?: number;
  maximumCostUsd?: number;
  maximum_cost_usd?: number;
  allowAutonomyDowngrade?: boolean;
  allow_autonomy_downgrade?: boolean;
}

export interface DisputeEvaluateInput
  extends Omit<
    OpenApiDisputeEvaluateRequest,
    "subject_id" | "task_id" | "evidence_ids" | "reason_code" | "preferred_resolution" | "disputed_by"
  > {
  subjectId?: string;
  subject_id?: string;
  taskId?: string;
  task_id?: string;
  evidenceIds?: string[];
  evidence_ids?: string[];
  reasonCode?: string;
  reason_code?: string;
  preferredResolution?: OpenApiDisputeEvaluateRequest["preferred_resolution"];
  preferred_resolution?: OpenApiDisputeEvaluateRequest["preferred_resolution"];
  disputedBy?: string;
  disputed_by?: string;
}

export interface SimRunInput extends OpenApiSimRunRequest {
  domainMix?: string[];
  numberOfAgents?: number;
  numberOfValidators?: number;
  failureRate?: number;
  collusionProbability?: number;
  reversalProbability?: number;
}

export interface WebhookCreateInput extends Omit<OpenApiWebhookCreateRequest, "event_types" | "max_attempts"> {
  eventTypes?: string[];
  event_types?: string[];
  maxAttempts?: number;
  max_attempts?: number;
}

export interface BudgetQuoteInput extends Omit<OpenApiBudgetQuoteRequest, "subject_id" | "response_mode" | "budget_cap_units" | "evidence_window"> {
  subjectId?: string;
  subject_id?: string;
  responseMode?: OpenApiBudgetQuoteRequest["response_mode"];
  response_mode?: OpenApiBudgetQuoteRequest["response_mode"];
  budgetCapUnits?: number;
  budget_cap_units?: number;
  evidenceWindow?: number;
  evidence_window?: number;
}

export interface PortabilityExportInput extends Omit<OpenApiPortabilityExportRequest, "subject_id" | "include_evidence" | "evidence_limit" | "include_trace_ids" | "target_network"> {
  subjectId?: string;
  subject_id?: string;
  includeEvidence?: boolean;
  include_evidence?: boolean;
  evidenceLimit?: number;
  evidence_limit?: number;
  includeTraceIds?: boolean;
  include_trace_ids?: boolean;
  targetNetwork?: string;
  target_network?: string;
}

export interface PortabilityImportInput extends OpenApiPortabilityImportRequest {
  importMode?: OpenApiPortabilityImportRequest["import_mode"];
  import_mode?: OpenApiPortabilityImportRequest["import_mode"];
}

export interface EconomicQuoteInput
  extends Omit<
    OpenApiEscrowQuoteRequest & OpenApiRiskPriceRequest & OpenApiAttestationBundleRequest,
    "subject_id" | "task_id" | "notional_usd" | "duration_hours" | "include_recent_evidence" | "evidence_limit"
  > {
  subjectId?: string;
  subject_id?: string;
  taskId?: string;
  task_id?: string;
  notionalUsd?: number;
  notional_usd?: number;
  durationHours?: number;
  duration_hours?: number;
  includeRecentEvidence?: boolean;
  include_recent_evidence?: boolean;
  evidenceLimit?: number;
  evidence_limit?: number;
}

export interface EventsSubscribeOptions {
  signal?: AbortSignal;
  onError?: (error: Error) => void;
}

export interface EventSubscribeFilters {
  types?: string | string[];
  subjects?: string | string[];
  since?: string | number;
  [key: string]: string | number | boolean | string[] | undefined;
}

export interface EventSubscription {
  abort(): void;
  done: Promise<void>;
}

export declare class InfopunksApiError extends Error {
  constructor(message: string, details: { status: number; body: ErrorEnvelope | string | null; requestPath: string });
  status: number;
  body: ErrorEnvelope | string | null;
  requestPath: string;
  code: string;
}

export declare class Infopunks {
  constructor(options: InfopunksOptions);
  passports: {
    register(input: PassportRegisterInput, opts?: RequestOptions): Promise<PassportCreated>;
    get(subjectId: string, opts?: { signal?: AbortSignal }): Promise<Passport>;
    rotateKey(subjectId: string, input: PassportRotateKeyInput, opts?: { signal?: AbortSignal }): Promise<Passport>;
  };
  evidence: {
    record(input: EvidenceRecordInput, opts?: RequestOptions): Promise<EvidenceAcceptedResponse>;
  };
  budget: {
    quote(input: BudgetQuoteInput, opts?: { signal?: AbortSignal }): Promise<BudgetQuote>;
  };
  webhooks: {
    create(input: WebhookCreateInput, opts?: { signal?: AbortSignal }): Promise<WebhookSubscription>;
  };
  portability: {
    export(input: PortabilityExportInput, opts?: { signal?: AbortSignal }): Promise<TrustPortabilityBundle>;
    import(input: PortabilityImportInput, opts?: { signal?: AbortSignal }): Promise<PortabilityImportResult>;
  };
  disputes: {
    evaluate(input: DisputeEvaluateInput, opts?: { signal?: AbortSignal }): Promise<DisputeEvaluation>;
  };
  trust: {
    resolve(input: TrustResolveInput, opts?: { signal?: AbortSignal }): Promise<TrustResolution>;
    explain(subjectId: string, params?: Record<string, string>, opts?: { signal?: AbortSignal }): Promise<TrustExplainResponse>;
  };
  routing: {
    selectValidator(input: RoutingSelectValidatorInput, opts?: { signal?: AbortSignal }): Promise<RoutingDecision>;
    selectExecutor(input: RoutingSelectExecutorInput, opts?: { signal?: AbortSignal }): Promise<RoutingDecision>;
  };
  economic: {
    escrowQuote(input: EconomicQuoteInput, opts?: { signal?: AbortSignal }): Promise<EscrowQuote>;
    riskPrice(input: EconomicQuoteInput, opts?: { signal?: AbortSignal }): Promise<RiskPriceQuote>;
    attestationBundle(input: EconomicQuoteInput, opts?: { signal?: AbortSignal }): Promise<AttestationBundle>;
  };
  traces: {
    get(traceId: string, opts?: { signal?: AbortSignal }): Promise<TraceReplayBundle>;
  };
  prompts: {
    get(name: string, opts?: { signal?: AbortSignal }): Promise<PromptPack>;
  };
  sim: {
    runScenario(input?: SimRunInput, opts?: { signal?: AbortSignal }): Promise<SimRunResponse>;
  };
  events: {
    subscribe(
      filters: string | EventSubscribeFilters,
      handler: (event: TrustEvent) => void,
      options?: EventsSubscribeOptions
    ): EventSubscription;
  };
}
