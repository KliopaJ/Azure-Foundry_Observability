export interface AppConfig {
  clientId: string
  tenantId: string
  apimName: string
  apimSubId: string
  apimRg: string
  apimApiId: string
  apimBackendId: string
  defaultTpm: number
}

export interface Subscription {
  id: string
  name: string
}

export interface FoundryResource {
  name: string
  rg: string
  subId?: string
  subName?: string
}

export interface DeploymentInfo {
  name: string
  model: string
  modelFormat: string
}

export interface UsageRow {
  deployment: string
  timestamp: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requests: number
}

export interface DepSummary {
  deployment: string
  model: string
  modelFormat: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  requests: number
  cost: number
}

export interface PolicyResponse {
  xml: string | null
  limits: Record<string, number>
  userLimits: Record<string, number>
  groupLimits: Record<string, number>
  defaultTpm: number
}

export interface UserActivity {
  apimSub: string
  display: string
  group: string
  success: number
  blocked: number
  total: number
}

export interface GroupActivity {
  groupId: string
  display: string
  members: string[]
  success: number
  blocked: number
  total: number
}

export interface UserModelStat {
  apimSub: string
  deployment: string
  calls: number
  blocked: number
}

export interface DepLimitConfig {
  type: 'tpm' | 'cost'
  value: number
  pricePerKTokens?: number
}

export interface CostLimits {
  users: Record<string, number>
  groups: Record<string, number>
  projectBudget?: number
  depLimitConfigs?: Record<string, DepLimitConfig>
}

export interface UsersGroupsData {
  users: UserActivity[]
  groups: GroupActivity[]
  userModelStats: UserModelStat[]
}
