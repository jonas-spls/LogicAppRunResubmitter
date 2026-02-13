export interface Subscription {
  subscriptionId: string
  displayName: string
  tenantId: string
}

export interface ResourceGroup {
  name: string
  location: string
}

export interface LogicApp {
  name: string
  location: string
  kind: string
}

export interface Workflow {
  name: string
}

export interface WorkflowRun {
  id: string
  name: string
  status: string
  startTime: string
  endTime?: string
}

export interface ResubmitProgress {
  runId: string
  status: 'success' | 'error'
  current: number
  total: number
  error?: string
}

export interface ResubmitResult {
  success: number
  failed: number
  cancelled: boolean
  errors: Array<{ runId: string; error: string }>
}
