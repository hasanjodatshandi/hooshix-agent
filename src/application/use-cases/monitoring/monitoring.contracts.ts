export interface GetMetricsUseCase { execute(): Promise<Readonly<Record<string,number>>>; }
export interface RunRetentionUseCase { execute(input: { readonly before: string; readonly dryRun: boolean }): Promise<{ readonly candidates: number; readonly removed: number }>; }
